import sharp from 'sharp'
import { z } from 'zod'
import type { ResourceImage } from '../../shared/schemas/media'
import type { PlanEntity } from '../../shared/utils/plan-entities'
import { hashKey } from '../../shared/utils/hash'
import { providerJson, readProviderBytes } from '../providers/http'
import { getCachedBinary, getCachedJson, setCachedBinary, setCachedJson } from './cache'

const WikiPageSchema = z.object({ title: z.string(), extract: z.string().optional(), pageprops: z.record(z.string(), z.unknown()).optional(), pageimage: z.string().optional() })
const PagesSchema = z.object({ query: z.object({ pages: z.record(z.string(), WikiPageSchema) }).optional() })
const AttributionSchema = z.object({ Artist: z.object({ value: z.string() }).optional(), LicenseShortName: z.object({ value: z.string() }).optional() })
const ImageInfoSchema = z.object({ query: z.object({ pages: z.record(z.string(), z.object({ imageinfo: z.array(z.object({ url: z.url(), thumburl: z.url().optional(), descriptionurl: z.url(), extmetadata: AttributionSchema.optional() })).optional() })) }).optional() })
const text = (input: string) => input.replace(/<[^>]*>/g, '').replace(/&[a-z0-9#]+;/gi, ' ').trim().slice(0, 1000)
const normalized = (input: string) => input.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()
const headers = { 'User-Agent': 'ShanhaiXingjian/1.0 (travel planner; Wikimedia image attribution retained)' }
export interface AcquiredImage { image: ResourceImage; originUrl: string; cacheKey: string }

function isWikimediaImageUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) && !url.username && !url.password } catch { return false }
}
export async function getResourceImageBytes(originUrl: string, cacheKey: string): Promise<Buffer> {
  if (!isWikimediaImageUrl(originUrl)) throw new Error('Unsupported media origin')
  const cached = await getCachedBinary(cacheKey)
  if (cached) return cached
  const response = await fetch(originUrl, { headers, signal: AbortSignal.timeout(12_000), redirect: 'error' })
  const bytes = await readProviderBytes(response, 5 * 1024 * 1024)
  const pipeline = sharp(bytes, { limitInputPixels: 24_000_000, failOn: 'warning' })
  const metadata = await pipeline.metadata()
  if (!['png', 'jpeg', 'webp'].includes(metadata.format || '') || (metadata.pages ?? 1) > 1) throw new Error('Unsupported media format')
  const result = await pipeline.rotate().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
  await setCachedBinary(cacheKey, result, 7 * 86400)
  return result
}

/** Require an exact encyclopedia identity and city evidence. Search ranking alone never proves a photo match. */
export async function acquireWikimediaImage(entity: PlanEntity, retryMissing = false): Promise<AcquiredImage | null> {
  const cacheId = await hashKey('wikimedia-identity-v2', { name: entity.name, city: entity.city, type: entity.entityType })
  const cached = await getCachedJson<AcquiredImage | { missing: true }>(cacheId)
  if (cached && 'missing' in cached && !retryMissing) return null
  if (cached && !('missing' in cached)) { await getResourceImageBytes(cached.originUrl, cached.cacheKey); return cached }
  const name = entity.name.normalize('NFKC').trim()
  const city = entity.city.normalize('NFKC').trim().replace(/市$/, '')
  // Remove only this entity's known city prefix; retain exact title + city evidence checks.
  const candidates = [name]
  if (city && name.startsWith(city)) {
    const localName = name.slice(city.length).replace(/^市/, '').trim()
    if (localName) candidates.push(localName)
  }
  let page: z.infer<typeof WikiPageSchema> | undefined
  for (const title of [...new Set(candidates)]) {
    const query = new URL('https://zh.wikipedia.org/w/api.php')
    query.search = new URLSearchParams({ action: 'query', format: 'json', titles: title, redirects: '1', converttitles: '1', prop: 'pageimages|extracts|pageprops', piprop: 'name', exintro: '1', explaintext: '1', exchars: '1500' }).toString()
    const pages = PagesSchema.parse(await providerJson(query, { headers })).query?.pages ?? {}
    // `titles` is an exact page request; MediaWiki handles canonical redirects and simplified/traditional aliases.
    page = Object.values(pages).find(value => value.pageimage && !Object.hasOwn(value.pageprops ?? {}, 'disambiguation')
      && (entity.entityType === 'food' || entity.entityType === 'city' || Boolean(entity.city && normalized(value.extract ?? '').includes(normalized(entity.city).replace(/市$/, '')))))
    if (page) break
  }
  if (!page?.pageimage) { await setCachedJson(cacheId, { missing: true }, 3600); return null }
  const commons = new URL('https://commons.wikimedia.org/w/api.php')
  commons.search = new URLSearchParams({ action: 'query', format: 'json', titles: `File:${page.pageimage}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '900' }).toString()
  const result = ImageInfoSchema.parse(await providerJson(commons, { headers }))
  const info = Object.values(result.query?.pages ?? {}).flatMap(value => value.imageinfo ?? [])[0]
  const metadata = info?.extmetadata
  if (!info || !metadata?.LicenseShortName?.value || !metadata.Artist?.value || !isWikimediaImageUrl(info.thumburl ?? info.url)) return null
  const originUrl = info.thumburl ?? info.url
  const cacheKey = await hashKey('wikimedia-image-v1', { url: originUrl })
  // Ready means the real image was fetched and decoded, not merely a plausible URL.
  await getResourceImageBytes(originUrl, cacheKey)
  const acquired: AcquiredImage = { originUrl, cacheKey, image: { url: '', sourceUrl: info.descriptionurl, provider: 'Wikimedia Commons', attribution: `${text(metadata.Artist.value)} · ${text(metadata.LicenseShortName.value)}`, kind: entity.entityType === 'food' ? 'food_illustration' : 'place_photo' } }
  await setCachedJson(cacheId, acquired, 86400)
  return acquired
}

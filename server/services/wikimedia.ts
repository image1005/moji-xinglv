import { z } from 'zod'
import { createError } from 'h3'
import type { PlanEntity } from '../../shared/utils/plan-entities'
import { hashKey } from '../../shared/utils/hash'
import { providerJson } from '../providers/http'
import { mediaIdentity, mediaNameKey, matchesWikiTitle, mentionsMediaSubject } from '../providers/media-identity'
import { getCachedJson, setCachedJson } from './cache'
import { getResourceImageBytes, type AcquiredImage } from './media-image'

const WikiPageSchema = z.object({ title: z.string(), extract: z.string().optional(), pageprops: z.record(z.string(), z.unknown()).optional(), pageimage: z.string().optional() })
const PagesSchema = z.object({ query: z.object({ pages: z.record(z.string(), WikiPageSchema) }).optional() })
const metadataField = z.object({ value: z.string() }).optional()
const AttributionSchema = z.object({ Artist: metadataField, LicenseShortName: metadataField, ImageDescription: metadataField, ObjectName: metadataField, Categories: metadataField })
const ImageInfo = z.object({ url: z.url(), thumburl: z.url().optional(), descriptionurl: z.url(), mime: z.string().optional(), extmetadata: AttributionSchema.optional() })
const ImageInfoSchema = z.object({ query: z.object({ pages: z.record(z.string(), z.object({ title: z.string().optional(), imageinfo: z.array(ImageInfo).optional() })) }).optional() })
const text = (input: string) => input.replace(/<[^>]*>/g, '').replace(/&[a-z0-9#]+;/gi, ' ').trim().slice(0, 1000)
const headers = { 'User-Agent': 'ShanhaiXingjian/1.0 (travel planner; Wikimedia image attribution retained)' }

function isWikimediaImageUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) && !url.username && !url.password } catch { return false }
}

const foodEvidence = /食品|食物|小吃|菜肴|菜餚|菜品|美食|面食|麵食|料理|甜品|甜点|甜點|菜式|饮品|飲品|羹|food|cuisine|dish|dessert|noodles|dumplings/i
const notSubjectPhoto = /票据|票據|菜单|菜單|招牌|示意图|示意圖|receipt|menu|diagram|logo|map of|signage/i
const searchTerm = (value: string) => value.replace(/["|:()\\]/g, ' ').trim().slice(0, 120)

function api(host: string, params: Record<string, string>) {
  const url = new URL(`https://${host}/w/api.php`)
  url.search = new URLSearchParams({ action: 'query', format: 'json', ...params }).toString()
  return url
}

/** Exact titles first, city-qualified encyclopedia lookup second, independently indexed Commons photos last. */
export async function acquireWikimediaImage(entity: PlanEntity, retryMissing = false): Promise<AcquiredImage | null> {
  const cacheId = await hashKey('wikimedia-identity-v3', { name: entity.name, city: entity.city, type: entity.entityType })
  const cached = await getCachedJson<AcquiredImage | { missing: true }>(cacheId)
  if (cached && 'missing' in cached && !retryMissing) return null
  const signal = AbortSignal.timeout(30_000)
  const errors: unknown[] = []
  if (cached && !('missing' in cached)) {
    try { await getResourceImageBytes(cached.originUrl, cached.cacheKey, signal); return cached } catch (error) { errors.push(error) }
  }
  const identity = mediaIdentity(entity)
  const attemptedImages = new Set<string>()
  let downloads = 0
  const read = async (url: URL) => {
    const data = await providerJson(url, { headers, signal })
    if (data && typeof data === 'object' && 'error' in data) {
      const code = (data.error as { code?: string } | null)?.code
      throw createError({ statusCode: 502, message: 'Media API rejected query', data: { providerStatus: code === 'ratelimited' ? 429 : 502 } })
    }
    return data
  }
  const acquire = async (info: z.infer<typeof ImageInfo>, matchedName: string): Promise<AcquiredImage | null> => {
    const metadata = info.extmetadata
    const originUrl = info.thumburl ?? info.url
    if (!metadata?.LicenseShortName?.value || !metadata.Artist?.value || !isWikimediaImageUrl(originUrl)
      || !/^https:\/\/commons\.wikimedia\.org\//.test(info.descriptionurl)
      || info.mime && !['image/jpeg', 'image/png', 'image/webp'].includes(info.mime)
      || attemptedImages.has(originUrl) || downloads >= 3) return null
    attemptedImages.add(originUrl); downloads++
    const cacheKey = await hashKey('wikimedia-image-v1', { url: originUrl })
    try {
      await getResourceImageBytes(originUrl, cacheKey, signal)
      const acquired: AcquiredImage = { originUrl, cacheKey, image: { url: '', sourceUrl: info.descriptionurl, provider: 'Wikimedia Commons', attribution: `${text(metadata.Artist.value)} · ${text(metadata.LicenseShortName.value)}`, kind: entity.entityType === 'food' ? 'food_illustration' : 'place_photo', matchedName: matchedName.slice(0, 200) } }
      await setCachedJson(cacheId, acquired, 86400)
      return acquired
    } catch (error) { errors.push(error); return null }
  }
  const fromWiki = async (pages: z.infer<typeof WikiPageSchema>[], searched: boolean): Promise<AcquiredImage | null> => {
    for (const page of pages) {
      if (!page.pageimage || Object.hasOwn(page.pageprops ?? {}, 'disambiguation')) continue
      if (searched && !matchesWikiTitle(page.title, identity.names, identity.city)) continue
      if (entity.entityType === 'spot' && (!identity.city || !mediaNameKey(page.extract ?? '').includes(mediaNameKey(identity.city)))) continue
      if (entity.entityType === 'food' && (!foodEvidence.test(page.extract ?? '') || /醫療|医疗|直腸|直肠|肛門|肛门/.test(page.extract ?? ''))) continue
      const payload = ImageInfoSchema.parse(await read(api('commons.wikimedia.org', { titles: `File:${page.pageimage}`, prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: '900' })))
      for (const info of Object.values(payload.query?.pages ?? {}).flatMap(value => value.imageinfo ?? [])) {
        const result = await acquire(info, page.title)
        if (result) return result
      }
    }
    return null
  }
  const wikiParams = { redirects: '1', converttitles: '1', prop: 'pageimages|extracts|pageprops', piprop: 'name', exintro: '1', explaintext: '1', exchars: '1500', exlimit: 'max' }
  // Exact requests preserve MediaWiki's authoritative redirects. No guessed image URLs.
  try {
    for (const title of identity.names) {
      const pages = PagesSchema.parse(await read(api('zh.wikipedia.org', { ...wikiParams, titles: title }))).query?.pages ?? {}
      const image = await fromWiki(Object.values(pages), false)
      if (image) return image
    }
    const pages = PagesSchema.parse(await read(api('zh.wikipedia.org', { ...wikiParams, generator: 'search', gsrsearch: `${searchTerm(identity.primary)} ${searchTerm(identity.city)}`, gsrnamespace: '0', gsrlimit: '5' }))).query?.pages ?? {}
    const image = await fromWiki(Object.values(pages), true)
    if (image) return image
  } catch (error) { errors.push(error) }

  // Commons may have a correctly described photograph even when no Chinese encyclopedia article exists.
  const names = [...new Set([identity.primary, ...identity.names])].filter(name => !/[()]/.test(name)).slice(0, 3)
  const searches = names.flatMap(name => entity.entityType === 'food' && identity.city
    ? [{ name, region: identity.city }, { name, region: '' }] : [{ name, region: identity.city }]).slice(0, 4)
  for (const { name, region } of searches) {
    try {
      const query = `${searchTerm(name)} ${searchTerm(region)} filetype:bitmap`
      const payload = ImageInfoSchema.parse(await read(api('commons.wikimedia.org', { generator: 'search', gsrsearch: query, gsrnamespace: '6', gsrlimit: '8', prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: '900' })))
      for (const page of Object.values(payload.query?.pages ?? {})) for (const info of page.imageinfo ?? []) {
        const meta = info.extmetadata
        const title = (page.title ?? '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
        const description = text(meta?.ImageDescription?.value ?? '')
        const label = text(meta?.ObjectName?.value ?? '')
        const evidence = `${title} ${label} ${description} ${text(meta?.Categories?.value ?? '')}`
        if (!/\.(?:jpe?g|png|webp)$/i.test(page.title ?? '') || notSubjectPhoto.test(evidence)) continue
        if (![title, label, description].some(value => mentionsMediaSubject(value, name))) continue
        if (entity.entityType === 'food' ? !foodEvidence.test(evidence) : !identity.city || !mediaNameKey(evidence).includes(mediaNameKey(identity.city))) continue
        const image = await acquire(info, name)
        if (image) return image
      }
    } catch (error) { errors.push(error); break }
  }
  // Outages are not negative matches, and must never poison the missing-image cache.
  if (errors.length) throw errors[0]
  await setCachedJson(cacheId, { missing: true }, 3600)
  return null
}

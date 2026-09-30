import { z } from 'zod'
import { createError } from 'h3'
import type { PlanEntity } from '../../shared/utils/plan-entities'
import { hashKey } from '../../shared/utils/hash'
import { mediaIdentity, mediaNameKey } from '../providers/media-identity'
import { providerJson } from '../providers/http'
import { getCachedJson, setCachedJson } from './cache'
import { getResourceImageBytes, type AcquiredImage } from './media-image'

const itemId = z.string().regex(/^Q[1-9]\d{0,12}$/)
const localized = z.object({ value: z.string().max(2000) })
const emptyMap = (value: unknown) => Array.isArray(value) && !value.length ? {} : value
const texts = z.preprocess(emptyMap, z.record(z.string().max(30), localized).refine(value => Object.keys(value).length <= 20))
const aliases = z.preprocess(emptyMap, z.record(z.string().max(30), z.array(localized).max(80)).refine(value => Object.keys(value).length <= 20))
const claim = z.object({
  rank: z.enum(['preferred', 'normal', 'deprecated']).optional(),
  mainsnak: z.object({ snaktype: z.string().max(20), datavalue: z.object({ value: z.union([z.string().max(1000), z.object({ id: itemId })]) }).optional() }),
})
const item = z.object({
  id: itemId, labels: texts.optional(), descriptions: texts.optional(), aliases: aliases.optional(),
  claims: z.preprocess(emptyMap, z.object({ P18: z.array(claim).max(20).optional(), P31: z.array(claim).max(80).optional(), P131: z.array(claim).max(30).optional() })).optional(),
  sitelinks: z.preprocess(emptyMap, z.record(z.string().max(30), z.object({ title: z.string().max(500) })).refine(value => Object.keys(value).length <= 4)).optional(),
})
const SearchSchema = z.object({ search: z.array(z.object({ id: itemId })).max(5) })
const EntitiesSchema = z.object({ entities: z.record(itemId, item).refine(value => Object.keys(value).length <= 15) })
const field = z.object({ value: z.string().max(20000) }).optional()
const ImageSchema = z.object({
  url: z.url(), thumburl: z.url().optional(), descriptionurl: z.url(), mime: z.string().max(100),
  extmetadata: z.object({ Artist: field, LicenseShortName: field, ImageDescription: field, ObjectName: field }).optional(),
})
const CommonsSchema = z.object({ query: z.object({ pages: z.record(z.string().max(30), z.object({ title: z.string().max(1000), imageinfo: z.array(ImageSchema).max(1).optional() })).refine(value => Object.keys(value).length <= 3) }) })
type Item = z.infer<typeof item>
const headers = { 'User-Agent': 'ShanhaiXingjian/1.0 (travel planner; Wikimedia image attribution retained)' }
const cleanText = (value: string) => value.replace(/<[^>]*>/g, '').replace(/&[a-z0-9#]+;/gi, ' ').trim().slice(0, 1000)
const namesOf = (value: Item) => [...Object.values(value.labels ?? {}).map(label => label.value), ...Object.values(value.aliases ?? {}).flatMap(list => list.map(label => label.value))]
const descriptionOf = (value: Item) => Object.values(value.descriptions ?? {}).map(description => description.value).join(' ')
const idsOf = (value: Item, property: 'P31' | 'P131') => (value.claims?.[property] ?? []).flatMap(statement => statement.rank !== 'deprecated' && statement.mainsnak.snaktype === 'value' && typeof statement.mainsnak.datavalue?.value === 'object' ? [statement.mainsnak.datavalue.value.id] : [])
const cityKey = (value: string) => mediaNameKey(value).replace(/市$/, '')
const cityType = /城市|地级市|地級市|县级市|縣級市|直辖市|直轄市|省会|省會|首都|城镇|城鎮|\b(?:city|town|capital|municipality)\b/i
const foodType = /食品|食物|小吃|菜肴|菜餚|菜品|美食|面食|麵食|料理|甜品|甜点|甜點|菜式|饮品|飲品|\b(?:food|dish|snack|dessert|beverage|noodles|dumplings)\b/i
const medical = /医疗|醫療|直肠|直腸|肛门|肛門|疾病|药物|藥物|\b(?:medical|enema|disease|treatment|medicine|drug)\b/i
const placeType = /寺|庙|廟|祠|宫|宮|园|園|景点|景點|景区|景區|遗址|遺址|建筑|建築|博物馆|博物館|纪念|紀念|广场|廣場|街道|古城|山峰|湖泊|瀑布|村落|桥梁|橋梁|\b(?:temple|shrine|palace|park|garden|museum|building|monument|memorial|landmark|attraction|site|street|square|village|mountain|lake|waterfall|bridge)\b/i
const wrongTypes = new Set(['Q4167410', 'Q4167836', 'Q13406463', 'Q5', 'Q13442814', 'Q571', 'Q11424', 'Q12136', 'Q796194'])
const cityTypes = new Set(['Q515', 'Q1549591', 'Q5119', 'Q200250', 'Q42744322', 'Q15284'])
const foodTypes = new Set(['Q2095', 'Q746549', 'Q1778821'])
const notPhoto = /票据|票據|菜单|菜單|示意图|示意圖|地图|地圖|旗帜|旗幟|徽章|\b(?:receipt|menu|diagram|logo|map|flag|coat of arms)\b/i

function allowedType(value: Item, kind: PlanEntity['entityType']) {
  const types = idsOf(value, 'P31'), description = descriptionOf(value)
  if (types.some(type => wrongTypes.has(type)) || /消歧|消歧义|消歧義|\bdisambiguation\b/i.test(description)) return false
  if (kind === 'food') return !medical.test(description) && (foodType.test(description) || types.some(type => foodTypes.has(type)))
  if (kind === 'city') return cityType.test(description) || types.some(type => cityTypes.has(type))
  return !medical.test(description) && placeType.test(description)
}

/** Location evidence comes from the entity, never the rank or snippet of a search hit. */
function inCity(value: Item, city: string, cityItem: Item | undefined) {
  if (cityItem && idsOf(value, 'P131').includes(cityItem.id)) return true
  const descriptions = Object.values(value.descriptions ?? {}).map(description => description.value)
  const cityNames = [...new Set([city, ...(cityItem ? namesOf(cityItem) : [])])].filter(name => name.length >= 2)
  return descriptions.some(description => {
    if (/相比|相较|相較|不同于|不同於|\b(?:unlike|compared|formerly)\b/i.test(description)) return false
    return cityNames.some(name => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (/^[\p{Script=Latin}\d .'-]+$/u.test(name)) return new RegExp(`\\b(?:in|at|of)\\s+(?:(?:the|city|district|municipality)\\s+(?:of\\s+)?)?${escaped}(?=[\\s,.;]|$)`, 'i').test(description)
      // Short factual Chinese descriptions normally put the administrative location before the place type.
      const prefix = description.split(/，|,|。|；|;/)[0] ?? ''
      return new RegExp(`${escaped}(?:市)?(?:[^，。；]{0,18})(?:的|寺|庙|廟|祠|宫|宮|园|園|景|建筑|建築|博物|街|遗址|遺址|湖|山|桥|橋)`).test(prefix)
    })
  })
}

function api(host: 'www.wikidata.org' | 'commons.wikimedia.org', params: Record<string, string>) {
  const url = new URL(`https://${host}/w/api.php`)
  url.search = new URLSearchParams({ format: 'json', ...params }).toString()
  return url
}

async function read(url: URL, signal: AbortSignal) {
  signal.throwIfAborted()
  const result = await providerJson(url, { headers, signal }, 1_000_000)
  if (result && typeof result === 'object' && 'error' in result) {
    const code = (result.error as { code?: string } | null)?.code
    throw createError({ statusCode: 502, message: 'Wikimedia API rejected query', data: { providerStatus: code === 'ratelimited' || code === 'maxlag' ? 429 : 502 } })
  }
  return result
}

/** Public Wikidata P18 photographs with exact identity and bounded location/type verification. */
export async function acquireWikidataImage(entity: PlanEntity, retryMissing = false, parentSignal?: AbortSignal): Promise<AcquiredImage | null> {
  const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(14_000)]) : AbortSignal.timeout(14_000)
  signal.throwIfAborted()
  const identity = mediaIdentity(entity)
  const cacheKey = await hashKey('wikidata-image-selection-v1', { ...identity, type: entity.entityType, address: entity.address })
  const cached = await getCachedJson<AcquiredImage | { missing: true }>(cacheKey)
  if (cached && 'missing' in cached && !retryMissing) return null
  const errors: unknown[] = []
  if (cached && !('missing' in cached)) {
    try { await getResourceImageBytes(cached.originUrl, cached.cacheKey, signal); return cached } catch (error) { signal.throwIfAborted(); errors.push(error) }
  }
  const queries = [...new Set([...identity.names.filter(name => !/[()]/.test(name)).slice(0, 2), ...(identity.city ? [identity.city] : [])])]
  const searches = await Promise.all(queries.map(async query => SearchSchema.parse(await read(api('www.wikidata.org', {
    action: 'wbsearchentities', search: query.slice(0, 120), language: 'zh', uselang: 'zh', type: 'item', limit: '5',
  }), signal)).search))
  const ids = [...new Set(searches.flatMap(results => results.map(result => result.id)))].slice(0, 15)
  const candidates = ids.length ? Object.values(EntitiesSchema.parse(await read(api('www.wikidata.org', {
    action: 'wbgetentities', ids: ids.join('|'), props: 'labels|aliases|descriptions|claims|sitelinks', languages: 'zh|zh-hans|zh-hant|en', languagefallback: '1', sitefilter: 'zhwiki|enwiki',
  }), signal)).entities) : []
  const cities = candidates.filter(value => allowedType(value, 'city') && namesOf(value).some(name => cityKey(name) === cityKey(identity.city)))
  const cityItem = cities.length === 1 ? cities[0] : undefined
  const eligible = candidates.filter(candidate => allowedType(candidate, entity.entityType)
    && (entity.entityType === 'city' ? candidate.id === cityItem?.id : entity.entityType !== 'spot' || inCity(candidate, identity.city, cityItem)))
  // A shared name and city do not identify two distinct landmarks. Resolve each component
  // independently so an ambiguous combined-visit name cannot hide another confirmed component.
  const matches = identity.names.flatMap(matchedName => {
    const named = eligible.filter(candidate => namesOf(candidate).some(label => entity.entityType === 'city' ? cityKey(label) === cityKey(matchedName) : mediaNameKey(label) === mediaNameKey(matchedName)))
    return named.length === 1 ? [{ candidate: named[0]!, matchedName }] : []
  })
  let attempts = 0
  const downloaded = new Set<string>()
  for (const { candidate, matchedName } of matches) {
    const photos = (candidate.claims?.P18 ?? []).filter(statement => statement.rank !== 'deprecated' && statement.mainsnak.snaktype === 'value').sort((a, b) => Number(b.rank === 'preferred') - Number(a.rank === 'preferred'))
    for (const photo of photos) {
      const filename = photo.mainsnak.datavalue?.value
      if (typeof filename !== 'string' || filename.includes('|') || !/\.(?:jpe?g|png|webp)$/i.test(filename) || notPhoto.test(filename) || downloaded.has(filename) || attempts >= 3) continue
      downloaded.add(filename); attempts++
      try {
        const pages = CommonsSchema.parse(await read(api('commons.wikimedia.org', { action: 'query', titles: `File:${filename}`, redirects: '1', prop: 'imageinfo', iiprop: 'url|extmetadata|mime', iiurlwidth: '900' }), signal)).query.pages
        for (const page of Object.values(pages)) for (const info of page.imageinfo ?? []) {
          const meta = info.extmetadata, originUrl = info.thumburl ?? info.url
          const origin = new URL(originUrl), source = new URL(info.descriptionurl)
          if (!meta?.Artist?.value.trim() || !meta.LicenseShortName?.value.trim() || !['image/jpeg', 'image/png', 'image/webp'].includes(info.mime)
            || origin.protocol !== 'https:' || origin.username || origin.password || origin.port || !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(origin.hostname)
            || source.protocol !== 'https:' || source.hostname !== 'commons.wikimedia.org' || source.username || source.password || source.port || !source.pathname.startsWith('/wiki/File:')
            || notPhoto.test(`${page.title} ${cleanText(meta.ObjectName?.value ?? '')} ${cleanText(meta.ImageDescription?.value ?? '')}`)) continue
          const binaryKey = await hashKey('wikidata-image-v1', { url: originUrl })
          await getResourceImageBytes(originUrl, binaryKey, signal)
          signal.throwIfAborted()
          const result: AcquiredImage = { originUrl, cacheKey: binaryKey, image: { url: '', provider: 'Wikidata · Wikimedia Commons', sourceUrl: source.href, attribution: `${cleanText(meta.Artist.value)} · ${cleanText(meta.LicenseShortName.value)}`, kind: entity.entityType === 'food' ? 'food_illustration' : 'place_photo', matchedName: matchedName.slice(0, 200) } }
          await setCachedJson(cacheKey, result, 86400)
          return result
        }
      } catch (error) { signal.throwIfAborted(); errors.push(error) }
    }
  }
  signal.throwIfAborted()
  if (errors.length) throw errors[0]
  await setCachedJson(cacheKey, { missing: true }, 600)
  return null
}

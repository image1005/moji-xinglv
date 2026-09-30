import type { PlanEntity } from '../../shared/utils/plan-entities'
import { hashKey } from '../../shared/utils/hash'
import { mediaIdentity, mediaNameKey, mentionsMediaSubject } from '../providers/media-identity'
import { searchTencentImages, tencentImageSearchEnabled } from '../providers/tencent-images'
import { getResourceImageBytes, trustedImageOrigin, type AcquiredImage } from './media-image'
import { acquireWikimediaImage } from './wikimedia'
import { acquireWikidataImage } from './wikidata-images'
import { acquireOpenverseImage } from './openverse-images'
import { getCachedJson, setCachedJson } from './cache'

export const IMAGE_RESOLVER_VERSION = 2
const resolving = new Map<string, Promise<AcquiredImage | null>>()

export async function acquireTravelImage(entity: PlanEntity, retryMissing = false): Promise<AcquiredImage | null> {
  const identity = mediaIdentity(entity)
  const key = await hashKey('travel-image-selection-v2', { ...identity, type: entity.entityType, address: entity.address, tencent: tencentImageSearchEnabled() })
  const existing = resolving.get(key)
  if (existing) return existing
  const job = (async () => {
    const cached = await getCachedJson<AcquiredImage>(key)
    if (cached) {
      try { await getResourceImageBytes(cached.originUrl, cached.cacheKey); return cached } catch { /* Rediscover an expired or unavailable CDN image. */ }
    }
    const result = await resolveTravelImage(entity, retryMissing)
    if (result) await setCachedJson(key, result, 86400)
    return result
  })().finally(() => resolving.delete(key))
  resolving.set(key, job)
  return job
}

async function resolveTravelImage(entity: PlanEntity, retryMissing: boolean): Promise<AcquiredImage | null> {
  const deadline = AbortSignal.timeout(60_000)
  const errors: unknown[] = []
  // Every free source gets a chance after a miss or outage. Paid lookup is opt-in.
  for (const acquire of [acquireWikidataImage, acquireWikimediaImage, acquireOpenverseImage]) {
    deadline.throwIfAborted()
    try { const image = await acquire(entity, retryMissing, deadline); if (image) return image } catch (error) { errors.push(error) }
  }
  if (!tencentImageSearchEnabled()) { if (errors.length) throw errors[0]; return null }
  deadline.throwIfAborted()
  const signal = AbortSignal.any([deadline, AbortSignal.timeout(20_000)])
  const identity = mediaIdentity(entity)
  const candidates = await searchTencentImages(`${identity.city} ${identity.primary} ${entity.entityType === 'food' ? '美食 实拍' : '实景'}`, signal)
  let failed: unknown, attempts = 0
  for (const candidate of candidates) {
    const subject = identity.names.find(name => mentionsMediaSubject(candidate.title, name))
    if (!subject || /票据|票據|菜单|菜單|示意图|示意圖|地图|地圖|AI生成|AI绘画|医疗|醫療|直肠|直腸/i.test(candidate.title)) continue
    if (entity.entityType !== 'food' && (!identity.city || !mediaNameKey(candidate.title).includes(mediaNameKey(identity.city)))) continue
    const source = new URL(candidate.siteUrl)
    if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) continue
    // Tencent returns some CDN thumbnails with http: in the documented response. Only upgrade
    // its fixed CDN hosts; never fetch arbitrary origPicUrl or a URL supplied by the user/model.
    const thumbnail = new URL(candidate.thumbnailUrl)
    if (thumbnail.protocol === 'http:') thumbnail.protocol = 'https:'
    if (!trustedImageOrigin(thumbnail.href) || !['lizhicdn.search.qq.com', 'imgcdn.qq.com'].includes(thumbnail.hostname) && !/^img\d{2}\.sogoucdn\.com$/.test(thumbnail.hostname)) continue
    if (++attempts > 3) break
    const cacheKey = await hashKey('tencent-image-v1', { url: thumbnail.href })
    try {
      await getResourceImageBytes(thumbnail.href, cacheKey, signal)
      return { originUrl: thumbnail.href, cacheKey, image: { url: '', provider: '腾讯云联网图像搜索', sourceUrl: source.href,
        attribution: `${candidate.siteName} · 原作者及许可请查看来源页面`, kind: entity.entityType === 'food' ? 'food_illustration' : 'place_photo', matchedName: subject } }
    } catch (error) { failed = error }
  }
  if (failed) throw failed
  if (errors.length) throw errors[0]
  return null
}

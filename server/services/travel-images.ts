import type { PlanEntity } from '../../shared/utils/plan-entities'
import { hashKey } from '../../shared/utils/hash'
import { mediaIdentity, mediaNameKey, mentionsMediaSubject } from '../providers/media-identity'
import { searchTencentImages, tencentImageSearchEnabled } from '../providers/tencent-images'
import { getResourceImageBytes, trustedImageOrigin, type AcquiredImage } from './media-image'
import { acquireWikimediaImage } from './wikimedia'

export async function acquireTravelImage(entity: PlanEntity, retryMissing = false): Promise<AcquiredImage | null> {
  let wikiError: unknown
  try { const image = await acquireWikimediaImage(entity, retryMissing); if (image) return image } catch (error) { wikiError = error }
  if (!tencentImageSearchEnabled()) { if (wikiError) throw wikiError; return null }
  const signal = AbortSignal.timeout(20_000)
  const identity = mediaIdentity(entity)
  const candidates = await searchTencentImages(`${identity.city} ${identity.primary} ${entity.entityType === 'food' ? '美食 实拍' : '实景'}`)
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
  if (wikiError) throw wikiError
  return null
}

import sharp from 'sharp'
import type { ResourceImage } from '../../shared/schemas/media'
import { readProviderBytes } from '../providers/http'
import { getCachedBinary, setCachedBinary } from './cache'

export interface AcquiredImage { image: ResourceImage; originUrl: string; cacheKey: string }
export function trustedImageOrigin(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (['upload.wikimedia.org', 'thumb.wikimedia.org', 'lizhicdn.search.qq.com', 'imgcdn.qq.com'].includes(url.hostname) || /^img\d{2}\.sogoucdn\.com$/.test(url.hostname))
  } catch { return false }
}

/** Fetch only provider-controlled image hosts. Redirects and arbitrary source-page origins are not followed. */
export async function getResourceImageBytes(originUrl: string, cacheKey: string, signal?: AbortSignal): Promise<Buffer> {
  if (!trustedImageOrigin(originUrl)) throw new Error('Unsupported media origin')
  const cached = await getCachedBinary(cacheKey)
  if (cached) return cached
  const response = await fetch(originUrl, { headers: { 'User-Agent': 'ShanhaiXingjian/1.0 (travel planner)' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000), redirect: 'error' })
  const bytes = await readProviderBytes(response, 5 * 1024 * 1024)
  const pipeline = sharp(bytes, { limitInputPixels: 24_000_000, failOn: 'warning' })
  const metadata = await pipeline.metadata()
  if (!['png', 'jpeg', 'webp'].includes(metadata.format || '') || (metadata.pages ?? 1) > 1) throw new Error('Unsupported media format')
  const result = await pipeline.rotate().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
  await setCachedBinary(cacheKey, result, 7 * 86400)
  return result
}

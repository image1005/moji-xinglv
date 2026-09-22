import sharp from 'sharp'
import { createError } from 'h3'
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

const downloading = new Map<string, Promise<Buffer>>()

/** Coalesce public image downloads before cache reads; each caller can stop waiting independently. */
export async function getResourceImageBytes(originUrl: string, cacheKey: string, signal?: AbortSignal): Promise<Buffer> {
  if (!trustedImageOrigin(originUrl)) throw new Error('Unsupported media origin')
  signal?.throwIfAborted()
  const key = `${cacheKey}:${originUrl}`
  let job = downloading.get(key)
  if (!job) {
    if (downloading.size >= 12) throw createError({ statusCode: 429, data: { providerStatus: 429 }, message: 'Image download queue full' })
    job = downloadImage(originUrl, cacheKey).finally(() => downloading.delete(key))
    downloading.set(key, job)
  }
  if (!signal) return job
  return new Promise<Buffer>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    job.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}

/** Only provider-controlled HTTPS hosts. One bounded download may complete for other consumers after cancellation. */
async function downloadImage(originUrl: string, cacheKey: string): Promise<Buffer> {
  const cached = await getCachedBinary(cacheKey)
  if (cached) return cached
  const response = await fetch(originUrl, { headers: { 'User-Agent': 'ShanhaiXingjian/1.0 (travel planner)' }, signal: AbortSignal.timeout(12_000), redirect: 'error' })
  const bytes = await readProviderBytes(response, 5 * 1024 * 1024)
  const pipeline = sharp(bytes, { limitInputPixels: 24_000_000, failOn: 'warning' })
  const metadata = await pipeline.metadata()
  if (!['png', 'jpeg', 'webp'].includes(metadata.format || '') || (metadata.pages ?? 1) > 1) throw new Error('Unsupported media format')
  const result = await pipeline.rotate().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
  await setCachedBinary(cacheKey, result, 7 * 86400)
  return result
}

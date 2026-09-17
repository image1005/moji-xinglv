import { createError } from 'h3'
import { PanoramaQuerySchema, StaticMapQuerySchema } from '../../shared/schemas/map'
import { hashKey } from '../../shared/utils/hash'
import { getCachedBinary, setCachedBinary } from './cache'
import { recordMetric } from './metrics'

/** 唯一可以读取百度 AK 的模块。仅允许两种图片接口，不透传任意 URL。 */
const BAIDU_BASE = 'https://api.map.baidu.com'
const TTL = 60 * 60 * 24 * 7
interface ImageResult { buffer: Buffer; contentType: string; cached: boolean }
const pending = new Map<string, Promise<ImageResult>>()

function imageType(buffer: Buffer): 'image/png' | 'image/jpeg' | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg'
  return null
}

function ak(): string {
  const value = process.env.BAIDU_MAP_AK
  if (!value || value.startsWith('Please ') || value.startsWith('your-')) {
    throw createError({ statusCode: 501, statusMessage: '地图尚未配置，请联系管理员设置百度服务端密钥' })
  }
  return value
}

async function fetchImage(api: 'staticimage/v2' | 'panorama/v2', params: Record<string, string>, userId?: string): Promise<ImageResult> {
  // 在任何异步缓存/哈希之前登记请求，避免快速响应与哈希完成顺序造成击穿。
  const key = `${api}:${JSON.stringify(params)}`
  const existing = pending.get(key)
  if (existing) return existing
  if (pending.size >= 12) throw createError({ statusCode: 429, statusMessage: '地图请求较多，请稍后重试' })
  const request = fetchImageUnshared(api, params, userId)
  pending.set(key, request)
  try { return await request } finally { pending.delete(key) }
}

async function fetchImageUnshared(api: 'staticimage/v2' | 'panorama/v2', params: Record<string, string>, userId?: string): Promise<ImageResult> {
  const service = api === 'panorama/v2' ? 'panorama' : 'staticmap'
  const metric = (outcome: 'success' | 'error' | 'cache_hit', durationMs = 0) => {
    try { recordMetric({ service, userId, outcome, durationMs }) }
    catch { console.warn('[maps] 无法记录本次调用指标') }
  }
  const hash = await hashKey(api, params)
  const cached = await getCachedBinary(hash)
  const cachedType = cached && imageType(cached)
  if (cached && cachedType && cached.length <= 8 * 1024 * 1024) {
    metric('cache_hit')
    return { buffer: cached, contentType: cachedType, cached: true }
  }
  const url = new URL(`${BAIDU_BASE}/${api}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  // Missing configuration and local cache failures are not external service calls.
  url.searchParams.set('ak', ak())
  const started = Date.now()
  let result: ImageResult
  try {
    let response: Response
    try { response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'error' }) }
    catch { throw createError({ statusCode: 502, statusMessage: '地图服务暂不可达，请稍后重试' }) }
    const contentType = response.headers.get('content-type')?.split(';')[0] ?? ''
    if (!response.ok || !['image/png', 'image/jpeg'].includes(contentType)) {
      await response.body?.cancel()
      throw createError({ statusCode: 502, statusMessage: '地图暂无可用影像，请检查坐标或服务端地图权限' })
    }
    if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024) {
      await response.body?.cancel()
      throw createError({ statusCode: 502, statusMessage: '地图图片超出大小限制' })
    }
    const chunks: Uint8Array[] = []
    const reader = response.body?.getReader()
    let size = 0
    if (!reader) throw createError({ statusCode: 502, statusMessage: '地图返回空内容' })
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 8 * 1024 * 1024) {
          await reader.cancel()
          throw createError({ statusCode: 502, statusMessage: '地图图片超出大小限制' })
        }
        chunks.push(value)
      }
    } catch {
      throw createError({ statusCode: 502, statusMessage: '地图影像读取失败或超出大小限制，请稍后重试' })
    } finally { reader.releaseLock() }
    const buffer = Buffer.concat(chunks)
    if (imageType(buffer) !== contentType) throw createError({ statusCode: 502, statusMessage: '地图影像格式不受支持' })
    result = { buffer, contentType, cached: false }
  } catch (error) {
    metric('error', Date.now() - started)
    throw error
  }
  metric('success', Date.now() - started)
  // Persisting a valid upstream image is a separate local operation.
  await setCachedBinary(hash, result.buffer, TTL)
  return result
}

export interface PanoramaQuery {
  location: string; width: number; height: number; heading?: number; pitch?: number; fov?: number
}
export async function getPanoramaImage(input: PanoramaQuery, userId?: string): Promise<ImageResult> {
  const query = PanoramaQuerySchema.parse(input)
  const params: Record<string, string> = { location: query.location, width: String(query.width), height: String(query.height), coordtype: 'bd09ll' }
  for (const field of ['heading', 'pitch', 'fov'] as const) if (query[field] !== undefined) params[field] = String(query[field])
  return fetchImage('panorama/v2', params, userId)
}

export interface StaticMapQuery {
  center?: string; zoom?: number; width?: number; height?: number; scale?: number
  markers?: string[]; paths?: string[]; pathStyles?: string; markerStyles?: string
}
export async function getStaticMapImage(input: StaticMapQuery, userId?: string): Promise<ImageResult> {
  const query = StaticMapQuerySchema.parse(input)
  const params: Record<string, string> = { width: String(query.width), height: String(query.height) }
  for (const field of ['center', 'zoom', 'scale', 'pathStyles', 'markerStyles'] as const) if (query[field] !== undefined) params[field] = String(query[field])
  if (query.markers?.length) params.markers = query.markers.join('|')
  if (query.paths?.length) params.paths = query.paths.join('|')
  return fetchImage('staticimage/v2', params, userId)
}

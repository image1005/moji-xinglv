import { wimgs } from 'tencentcloud-sdk-nodejs-wimgs'
import { z } from 'zod'
import { createError } from 'h3'
import { getCachedJson, setCachedJson } from '../services/cache'
import { hashKey } from '../../shared/utils/hash'

const ImageSchema = z.object({
  thumbnailUrl: z.url(), origPicUrl: z.url().optional(), siteUrl: z.url(), siteName: z.string().max(300), title: z.string().max(1000),
  thumbnailWidth: z.number().optional(), thumbnailHeight: z.number().optional(),
})
const ResponseSchema = z.object({ Images: z.array(z.string().max(20000)).max(20), RequestId: z.string().optional() })
type SearchImage = z.infer<typeof ImageSchema>

export function tencentImageSearchEnabled() {
  const mode = process.env.MEDIA_IMAGE_SEARCH || 'auto'
  return mode === 'tencent' || mode === 'auto' && Boolean(process.env.TENCENTCLOUD_SECRET_ID?.trim() && process.env.TENCENTCLOUD_SECRET_KEY?.trim())
}
const inflight = new Map<string, Promise<SearchImage[]>>()
let window = 0, requests = 0

/** One billable request per normalized query; results including empty results stay cached for ten minutes. */
export async function searchTencentImages(query: string): Promise<SearchImage[]> {
  if (!tencentImageSearchEnabled()) return []
  if (!process.env.TENCENTCLOUD_SECRET_ID?.trim() || !process.env.TENCENTCLOUD_SECRET_KEY?.trim()) {
    throw createError({ statusCode: 503, data: { mediaConfiguration: true }, message: 'Tencent image search is not configured' })
  }
  query = query.trim().slice(0, 200)
  const key = await hashKey('tencent-image-search-v1', { query })
  if (inflight.has(key)) return inflight.get(key)!
  const job = (async () => {
    const cached = await getCachedJson<SearchImage[]>(key)
    if (cached) return cached
    const now = Date.now()
    if (now - window >= 3600000) { window = now; requests = 0 }
    const limit = z.coerce.number().int().min(1).max(10000).parse(process.env.MEDIA_IMAGE_SEARCH_HOURLY_LIMIT || 60)
    if (requests >= limit) throw createError({ statusCode: 429, data: { providerStatus: 429 }, message: 'Image search budget reached' })
    requests++
    const client = new wimgs.v20251106.Client({ credential: { secretId: process.env.TENCENTCLOUD_SECRET_ID, secretKey: process.env.TENCENTCLOUD_SECRET_KEY, token: process.env.TENCENTCLOUD_TOKEN || undefined },
      profile: { signMethod: 'TC3-HMAC-SHA256', httpProfile: { endpoint: 'wimgs.tencentcloudapi.com', protocol: 'https://', reqTimeout: 12 } },
    })
    const signal = AbortSignal.timeout(12_000)
    try {
      // SDK's generic request supports AbortSignal; the generated convenience method only exposes a callback.
      const payload = ResponseSchema.parse(await client.request('SearchByText', { Query: query }, { signal }))
      let malformed = 0
      const images = payload.Images.flatMap(value => {
        try { const parsed = ImageSchema.safeParse(JSON.parse(value)); if (parsed.success) return [parsed.data] } catch { /* bounded malformed record */ }
        malformed++; return []
      })
      if (payload.Images.length && malformed === payload.Images.length) throw new SyntaxError('Invalid image search records')
      await setCachedJson(key, images, 600)
      return images
    } catch (error) {
      if (signal.aborted) throw signal.reason
      const code = (error as { code?: string } | null)?.code || ''
      if (/AuthFailure|Unauthorized|ServiceNotActivated/.test(code)) throw createError({ statusCode: 503, data: { mediaConfiguration: true }, message: 'Image search credentials or service activation invalid' })
      if (/LimitExceeded|RequestLimitExceeded/.test(code)) throw createError({ statusCode: 429, data: { providerStatus: 429 }, message: 'Image search limit reached' })
      throw error
    }
  })().finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

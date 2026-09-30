import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { getResourceImageBytes, trustedImageOrigin } from '../server/services/media-image'

const cache = vi.hoisted(() => ({ bytes: new Map<string, Buffer>(), writes: vi.fn() }))
vi.mock('../server/services/cache', () => ({
  getCachedBinary: async (key: string) => cache.bytes.get(key) ?? null,
  setCachedBinary: async (key: string, value: Buffer, ttl: number) => { cache.bytes.set(key, value); cache.writes(key, ttl) },
}))
const url = 'https://upload.wikimedia.org/photo.png'
let bytes: Buffer
beforeEach(async () => {
  cache.bytes.clear(); cache.writes.mockClear()
  bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#668844' } }).png().toBuffer()
})
afterEach(() => vi.unstubAllGlobals())

it('缓存未命中时并发只下载解码一次，后续命中不访问外网，TTL为7天', async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  const result = await Promise.all(Array.from({ length: 5 }, () => getResourceImageBytes(url, 'image-key')))
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(cache.writes).toHaveBeenCalledWith('image-key', 7 * 86400)
  expect(await getResourceImageBytes(url, 'image-key')).toEqual(result[0])
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect((await sharp(result[0]!).metadata()).format).toBe('webp')
})
it('一个消费者取消不终止另一个消费者需要的下载', async () => {
  let release!: () => void
  const gate = new Promise<void>(done => { release = done })
  let reached!: () => void
  const started = new Promise<void>(done => { reached = done })
  const fetcher = vi.fn().mockImplementation(async (_url, options) => { reached(); await gate; expect(options.signal.aborted).toBe(false); return new Response(bytes) })
  vi.stubGlobal('fetch', fetcher)
  const controller = new AbortController()
  const first = getResourceImageBytes(url, 'shared', controller.signal)
  const rejected = expect(first).rejects.toThrow('cancelled')
  const second = getResourceImageBytes(url, 'shared')
  await started
  controller.abort(new Error('cancelled'))
  await rejected
  release()
  expect((await second).byteLength).toBeGreaterThan(0)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('失败不写缓存，后续请求能重试成功', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  await expect(getResourceImageBytes(url, 'retry')).rejects.toThrow('network')
  expect(cache.bytes.size).toBe(0)
  expect((await getResourceImageBytes(url, 'retry')).byteLength).toBeGreaterThan(0)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('私网URL和提前取消的调用不能借已有缓存绕过边界', async () => {
  cache.bytes.set('existing', bytes)
  vi.stubGlobal('fetch', vi.fn())
  await expect(getResourceImageBytes('http://127.0.0.1/private', 'existing')).rejects.toThrow('Unsupported')
  const controller = new AbortController(); controller.abort(new Error('cancelled'))
  await expect(getResourceImageBytes(url, 'existing', controller.signal)).rejects.toThrow('cancelled')
  expect(fetch).not.toHaveBeenCalled()
})
it('仅允许Openverse受控UUID缩略图，不开放任意API路径、参数或来源图片', async () => {
  const thumbnail = 'https://api.openverse.org/v1/images/e147b616-539b-4938-a6eb-a1113836f340/thumb/'
  expect(trustedImageOrigin(thumbnail)).toBe(true)
  expect(trustedImageOrigin('https://live.staticflickr.com/65535/54199297843_0dbd1c370a_b.jpg')).toBe(true)
  for (const unsafe of [
    `${thumbnail}?url=http://127.0.0.1/`, `${thumbnail}#fragment`, thumbnail.replace('api.openverse.org', 'api.openverse.org.evil.org'),
    thumbnail.replace('e147b616-539b-4938-a6eb-a1113836f340', 'unknown'), 'https://api.openverse.org/v1/images/',
    'https://api.openverse.org/redirect?url=http://127.0.0.1/', 'https://www.flickr.com/photos/image.jpg',
    'https://live.staticflickr.com/redirect', 'https://live.staticflickr.com/65535/54199297843_0dbd1c370a_b.jpg?url=http://localhost',
    'https://live.staticflickr.com.evil.org/65535/54199297843_0dbd1c370a_b.jpg',
  ]) expect(trustedImageOrigin(unsafe)).toBe(false)
  const fetcher = vi.fn().mockResolvedValue(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  expect((await sharp(await getResourceImageBytes(thumbnail, 'openverse-image')).metadata()).format).toBe('webp')
  expect(fetcher).toHaveBeenCalledWith(thumbnail, expect.objectContaining({ redirect: 'error' }))
})
it('Openverse返回重定向或错误内容时不写图片缓存', async () => {
  const thumbnail = 'https://api.openverse.org/v1/images/e147b616-539b-4938-a6eb-a1113836f340/thumb/'
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } }))
  vi.stubGlobal('fetch', fetcher)
  await expect(getResourceImageBytes(thumbnail, 'redirect')).rejects.toThrow()
  fetcher.mockResolvedValue(Response.json({ error: 'missing thumbnail' }, { status: 424 }))
  await expect(getResourceImageBytes(thumbnail, 'unavailable')).rejects.toThrow()
  expect(cache.bytes.size).toBe(0)
})

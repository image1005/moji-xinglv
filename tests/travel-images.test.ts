import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { acquireTravelImage } from '../server/services/travel-images'
import { trustedImageOrigin } from '../server/services/media-image'
const mocks = vi.hoisted(() => ({ wiki: vi.fn(), search: vi.fn(), binary: new Map<string, Buffer>(), json: new Map<string, unknown>() }))
vi.mock('../server/services/wikimedia', () => ({ acquireWikimediaImage: mocks.wiki }))
vi.mock('../server/providers/tencent-images', () => ({ searchTencentImages: mocks.search, tencentImageSearchEnabled: () => true }))
vi.mock('../server/services/cache', () => ({
  getCachedBinary: async (key: string) => mocks.binary.get(key), setCachedBinary: async (key: string, value: Buffer) => { mocks.binary.set(key, value) },
  getCachedJson: async (key: string) => mocks.json.get(key), setCachedJson: async (key: string, value: unknown) => { mocks.json.set(key, value) },
}))
const entity = { entityId: 'spot:1', entityType: 'spot' as const, name: '晋祠', city: '太原（晋源区）', address: '', fingerprint: 'unchanged' }
const candidate = (title: string, url = 'https://img01.sogoucdn.com/test.jpg') => ({ title, thumbnailUrl: url, siteUrl: 'https://example.org/article', siteName: '测试来源' })
beforeEach(() => { vi.clearAllMocks(); mocks.binary.clear(); mocks.json.clear(); mocks.wiki.mockResolvedValue(null) })
afterEach(() => vi.unstubAllGlobals())
it('免费来源成功时不调用付费搜索', async () => {
  mocks.wiki.mockResolvedValue({ image: { provider: 'Wikimedia Commons' } })
  expect(await acquireTravelImage(entity)).toMatchObject({ image: { provider: 'Wikimedia Commons' } })
  expect(mocks.search).not.toHaveBeenCalled()
})
it('拒绝私网、假域名、非标准端口和未核实任意原图站点', async () => {
  for (const url of ['http://img01.sogoucdn.com/x', 'https://127.0.0.1/x', 'https://img01.sogoucdn.com.evil.org/x', 'https://img01.sogoucdn.com:444/x', 'https://user:pass@img01.sogoucdn.com/x', 'https://example.org/photo']) expect(trustedImageOrigin(url)).toBe(false)
  expect(trustedImageOrigin('https://img01.sogoucdn.com/image.jpg')).toBe(true)
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  mocks.search.mockResolvedValue([candidate('太原晋祠实拍', 'https://127.0.0.1/private'), candidate('其他城市晋祠实拍'), candidate('太原晋祠地图'), candidate('太原其他景点')])
  expect(await acquireTravelImage(entity)).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
})
it('供应商网络异常保留失败状态，不冒充暂无匹配', async () => {
  mocks.wiki.mockRejectedValue(new TypeError('network'))
  mocks.search.mockResolvedValue([])
  await expect(acquireTravelImage(entity)).rejects.toThrow(TypeError)
})
it('腾讯候选经真实解码才可展示，并保留来源和精确命中名称', async () => {
  const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#668844' } }).png().toBuffer()
  const fetcher = vi.fn().mockResolvedValue(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  mocks.search.mockResolvedValue([candidate('太原晋祠实拍', 'http://img01.sogoucdn.com/test.jpg')])
  const result = await acquireTravelImage(entity)
  expect(result).toMatchObject({ originUrl: 'https://img01.sogoucdn.com/test.jpg', image: { provider: '腾讯云联网图像搜索', sourceUrl: 'https://example.org/article', matchedName: '晋祠', kind: 'place_photo' } })
  expect(fetcher).toHaveBeenCalledWith('https://img01.sogoucdn.com/test.jpg', expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }))
})
it('腾讯返回网页伪装成照片时不会标记成功', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>not a photo</html>')))
  mocks.search.mockResolvedValue([candidate('太原晋祠实拍')])
  await expect(acquireTravelImage(entity)).rejects.toThrow()
})
it('不同工作区相同地点复用选图和字节缓存，并发只解析一次', async () => {
  const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#668844' } }).png().toBuffer()
  const fetcher = vi.fn().mockResolvedValue(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  mocks.search.mockResolvedValue([candidate('太原晋祠实拍')])
  const other = { ...entity, entityId: 'spot:another-workspace', fingerprint: 'another' }
  const [one, two] = await Promise.all([acquireTravelImage(entity), acquireTravelImage(other)])
  expect(one).toEqual(two)
  expect(await acquireTravelImage(other)).toEqual(one)
  expect(mocks.wiki).toHaveBeenCalledTimes(1)
  expect(mocks.search).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledTimes(1)
  await acquireTravelImage({ ...other, city: '另一个城市' })
  expect(mocks.search).toHaveBeenCalledTimes(2)
})

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { acquireOpenverseImage } from '../server/services/openverse-images'

const mocks = vi.hoisted(() => ({ binary: new Map<string, Buffer>(), json: new Map<string, { value: unknown; expires: number }>(), writes: vi.fn() }))
vi.mock('../server/services/cache', () => ({
  getCachedBinary: async (key: string) => mocks.binary.get(key),
  setCachedBinary: async (key: string, value: Buffer) => { mocks.binary.set(key, value) },
  getCachedJson: async (key: string) => { const item = mocks.json.get(key); return item && item.expires > Date.now() ? item.value : null },
  setCachedJson: async (key: string, value: unknown, ttl: number) => { mocks.writes(key, value, ttl); mocks.json.set(key, { value: structuredClone(value), expires: Date.now() + ttl * 1000 }) },
}))

const entity = { entityId: 'spot:1', entityType: 'spot' as const, name: '晋祠', city: '太原（晋源区）', address: '', fingerprint: '1' }
const id = 'e147b616-539b-4938-a6eb-a1113836f340'
const thumbnail = `https://api.openverse.org/v1/images/${id}/thumb/`
const candidate = (title = '太原晋祠照片', extra: Record<string, unknown> = {}) => ({ id, title, thumbnail,
  foreign_landing_url: 'https://www.flickr.com/photos/example/1', creator: 'Example photographer', license: 'by-sa', license_version: '4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/', tags: [{ name: 'photograph' }], ...extra })
const response = (results: unknown[]) => new Response(JSON.stringify({ results }), { headers: { 'Content-Type': 'application/json' } })
let bytes: Buffer
beforeEach(async () => {
  vi.clearAllMocks(); mocks.binary.clear(); mocks.json.clear()
  bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#668844' } }).png().toBuffer()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('匿名城市加名称搜索、受控缩略图解码和来源署名', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([candidate()])).mockResolvedValueOnce(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  const result = await acquireOpenverseImage(entity)
  expect(result).toMatchObject({ originUrl: thumbnail, image: { provider: 'Openverse', sourceUrl: 'https://www.flickr.com/photos/example/1', matchedName: '晋祠', kind: 'place_photo', attribution: 'Example photographer · BY-SA 4.0' } })
  const url = new URL(String(fetcher.mock.calls[0]?.[0]))
  expect(url.searchParams.get('q')).toBe('太原 晋祠')
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) })
  expect(fetcher.mock.calls[0]?.[1].headers.Authorization).toBeUndefined()
  expect(fetcher.mock.calls[1]?.[0]).toBe(thumbnail)
  expect(await sharp(mocks.binary.get(result!.cacheKey)).metadata()).toMatchObject({ format: 'webp', width: 12, height: 8 })
  expect(mocks.writes).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ originUrl: thumbnail }), 86400)
})

it('不直接取首图：拒绝同名异地、缺城市证据及地图', async () => {
  const fetcher = vi.fn().mockResolvedValue(response([
    candidate('灵石晋祠照片'), candidate('晋祠照片'), candidate('太原晋祠地图'), candidate('其他景点', { description: '太原风景' }),
  ]))
  vi.stubGlobal('fetch', fetcher)
  expect(await acquireOpenverseImage(entity)).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('景点城市不得由标签或比较描述拼凑证明', async () => {
  const fetcher = vi.fn().mockResolvedValue(response([
    candidate('大同纯阳宫照片', { tags: [{ name: '太原' }] }),
    candidate('纯阳宫照片', { description: '太原纯阳宫与大同纯阳宫不同，照片位于大同。' }),
    candidate('纯阳宫照片', { description: '不同于太原纯阳宫，这座建筑位于大同。' }),
    candidate('纯阳宫照片', { description: '太原纯阳宫附近的建筑' }),
  ]))
  vi.stubGlobal('fetch', fetcher)
  expect(await acquireOpenverseImage({ ...entity, name: '纯阳宫' })).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('标题仅地点名时可由明确定位的描述补充城市证据', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([candidate('纯阳宫照片', { description: '纯阳宫位于太原市迎泽区。' })]))
    .mockResolvedValueOnce(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  expect(await acquireOpenverseImage({ ...entity, name: '纯阳宫' })).toMatchObject({ image: { matchedName: '纯阳宫' } })
})

it('明确非摄影分类和绘画标题不能冒充地点实景', async () => {
  const fetcher = vi.fn().mockResolvedValue(response([
    candidate('北京天安门照片', { category: 'illustration' }), candidate('北京天安门水彩画'),
    candidate('北京天安门 drawing', { tags: [{ name: '天安门' }] }),
  ]))
  vi.stubGlobal('fetch', fetcher)
  expect(await acquireOpenverseImage({ ...entity, name: '天安门', city: '北京' })).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('只下载与返回UUID一致的官方缩略图，拒绝任意原站和伪造代理地址', async () => {
  const fetcher = vi.fn().mockResolvedValue(response([
    candidate(undefined, { thumbnail: 'https://127.0.0.1/private' }),
    candidate(undefined, { thumbnail: `${thumbnail}?url=https://127.0.0.1/private` }),
    candidate(undefined, { thumbnail: 'https://api.openverse.org.evil.example/a' }),
    candidate(undefined, { foreign_landing_url: 'javascript:alert(1)' }),
    candidate(undefined, { creator: null }),
  ]))
  vi.stubGlobal('fetch', fetcher)
  expect(await acquireOpenverseImage(entity)).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('菜品示意允许异地同菜，但拒绝拌面和仅标签误命中的牛肉面', async () => {
  const food = { ...entity, entityType: 'food' as const, name: '过油肉' }
  const fetcher = vi.fn().mockResolvedValueOnce(response([
    candidate('新疆过油肉拌面', { tags: [{ name: '过油肉' }] }),
    candidate('新疆炒牛肉面', { tags: [{ name: '过油肉' }] }),
    candidate('榆次过油肉'),
  ])).mockResolvedValueOnce(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  expect(await acquireOpenverseImage(food)).toMatchObject({ image: { kind: 'food_illustration', matchedName: '过油肉' } })
  expect(new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.get('q')).toBe('过油肉')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('缓存成功一天、跨工作区并发合并且不再消耗搜索配额', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([candidate()])).mockResolvedValueOnce(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  const [first, second] = await Promise.all([acquireOpenverseImage(entity), acquireOpenverseImage({ ...entity, entityId: 'another', fingerprint: 'another' })])
  expect(second).toEqual(first)
  expect(await acquireOpenverseImage(entity, true)).toEqual(first)
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('空匹配只缓存十分钟，手动重试可绕过空缓存', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([candidate()])).mockResolvedValueOnce(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  expect(await acquireOpenverseImage(entity)).toBeNull()
  expect(await acquireOpenverseImage(entity)).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(mocks.writes).toHaveBeenCalledWith(expect.any(String), { missing: true }, 600)
  expect(await acquireOpenverseImage(entity, true)).toMatchObject({ originUrl: thumbnail })
  expect(fetcher).toHaveBeenCalledTimes(3)
})

it('网络失败、无效响应和假图片不写负缓存，下次允许重新请求', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('network'))
    .mockResolvedValueOnce(new Response('{bad json'))
    .mockResolvedValueOnce(response([candidate()])).mockResolvedValueOnce(new Response('<html>not a photo</html>'))
    .mockResolvedValueOnce(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  await expect(acquireOpenverseImage(entity)).rejects.toThrow('network')
  await expect(acquireOpenverseImage(entity)).rejects.toThrow()
  await expect(acquireOpenverseImage(entity)).rejects.toThrow()
  expect(mocks.writes.mock.calls.some(call => call[1]?.missing)).toBe(false)
  expect(await acquireOpenverseImage(entity)).toMatchObject({ originUrl: thumbnail })
  expect(fetcher).toHaveBeenCalledTimes(5)
})

it('429持久化Retry-After退避，重试不绕过且恢复后可搜索', async () => {
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '120' } })).mockResolvedValueOnce(response([]))
  vi.stubGlobal('fetch', fetcher)
  await expect(acquireOpenverseImage(entity)).rejects.toMatchObject({ statusCode: 429, data: { providerStatus: 429, retryAfter: 120 } })
  await expect(acquireOpenverseImage(entity, true)).rejects.toMatchObject({ statusCode: 429 })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(mocks.writes.mock.calls.some(call => call[1]?.missing)).toBe(false)
  now += 120_001
  expect(await acquireOpenverseImage(entity, true)).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('并发不同景点的匿名配额最多每小时五次，后续请求读取持久配额', async () => {
  const fetcher = vi.fn().mockImplementation(async () => response([]))
  vi.stubGlobal('fetch', fetcher)
  const results = await Promise.allSettled(Array.from({ length: 7 }, (_, index) => acquireOpenverseImage({ ...entity, name: `景点${index}` })))
  expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(5)
  expect(results.filter(item => item.status === 'rejected')).toHaveLength(2)
  expect(fetcher).toHaveBeenCalledTimes(5)
  await expect(acquireOpenverseImage({ ...entity, name: '新景点' })).rejects.toMatchObject({ statusCode: 429 })
})

it('代理424仅回退到同photoID的Flickr固定CDN并真实解码', async () => {
  const original = 'https://live.staticflickr.com/65535/54199297843_0dbd1c370a_b.jpg'
  const fetcher = vi.fn().mockResolvedValueOnce(response([candidate(undefined, { source: 'flickr', url: original, foreign_landing_url: 'https://www.flickr.com/photos/200217583@N05/54199297843' })]))
    .mockResolvedValueOnce(new Response('{}', { status: 424 })).mockResolvedValueOnce(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  expect(await acquireOpenverseImage(entity)).toMatchObject({ originUrl: original })
  expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual([expect.stringContaining('api.openverse.org/v1/images/?'), thumbnail, original])
})

it('受控原图回退拒绝photoID错配、任意原站和伪造Flickr来源', async () => {
  for (const extra of [
    { source: 'flickr', url: 'https://live.staticflickr.com/65535/54199297843_0dbd1c370a_b.jpg', foreign_landing_url: 'https://www.flickr.com/photos/example/2' },
    { source: 'flickr', url: 'https://example.org/image.jpg' },
    { source: 'flickr', url: 'https://live.staticflickr.com/65535/1_0dbd1c370a_b.jpg', foreign_landing_url: 'https://flickr.com.evil.org/photos/example/1' },
  ]) {
    mocks.json.clear()
    const fetcher = vi.fn().mockResolvedValueOnce(response([candidate(undefined, extra)])).mockResolvedValueOnce(new Response('{}', { status: 424 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(acquireOpenverseImage(entity, true)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(2)
  }
})

it('图片暂时失败后复用一天的有效搜索结果，不再请求搜索接口', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([candidate()]))
    .mockResolvedValueOnce(new Response('{}', { status: 424 })).mockResolvedValueOnce(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  await expect(acquireOpenverseImage(entity)).rejects.toThrow()
  expect(await acquireOpenverseImage(entity, true)).toMatchObject({ originUrl: thumbnail })
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(fetcher.mock.calls.filter(call => new URL(String(call[0])).pathname === '/v1/images/')).toHaveLength(1)
  expect(mocks.writes).toHaveBeenCalledWith(expect.any(String), { results: [expect.objectContaining({ id })] }, 86400)
})

it('Wikimedia候选的代理失败可回退原有受控维基图片域名', async () => {
  const original = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Jinci.jpg'
  const fetcher = vi.fn().mockResolvedValueOnce(response([candidate(undefined, { source: 'wikimedia', url: `${original}?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original` })]))
    .mockResolvedValueOnce(new Response('{}', { status: 424 })).mockResolvedValueOnce(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  expect(await acquireOpenverseImage(entity)).toMatchObject({ originUrl: original })
  expect(fetcher).toHaveBeenCalledTimes(3)
})

it('每日配额耗尽不请求供应商', async () => {
  const now = Date.now()
  mocks.json.set('openverse-anonymous-budget-v1', { value: { hourStartedAt: now, hourUsed: 0, dayStartedAt: now, dayUsed: 100, blockedUntil: 0 }, expires: now + 86400_000 })
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(acquireOpenverseImage(entity)).rejects.toMatchObject({ statusCode: 429 })
  expect(fetcher).not.toHaveBeenCalled()
})

it('预取消不消耗额度，运行中取消传播到搜索请求且不负缓存', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(acquireOpenverseImage(entity, false, controller.signal)).rejects.toThrow('cancelled')
  expect(fetcher).not.toHaveBeenCalled()
  const running = new AbortController()
  let started!: () => void
  const searching = new Promise<void>(resolve => { started = resolve })
  fetcher.mockImplementation((_url: URL, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }); started()
  }))
  const job = acquireOpenverseImage(entity, false, running.signal)
  await searching
  running.abort(new Error('stopped'))
  await expect(job).rejects.toThrow('stopped')
  expect(mocks.writes.mock.calls.some(call => call[1]?.missing)).toBe(false)
})

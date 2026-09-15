import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
vi.mock('../server/services/cache', () => ({ getCachedBinary: mocks.get, setCachedBinary: mocks.set }))
const { getPanoramaImage } = await import('../server/services/baidu')
const input = { location: '116.4,39.9', width: 640, height: 360 }
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])

describe('百度影像代理安全边界', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockResolvedValue(null)
    mocks.set.mockResolvedValue(undefined)
    vi.stubEnv('BAIDU_MAP_AK', 'audit-fake-not-a-real-key')
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  it('拒绝非法坐标且不调用上游', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(getPanoramaImage({ ...input, location: '999,99' })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('不透传上游错误与密钥', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('audit-fake-not-a-real-key', { status: 403 })))
    const error = await getPanoramaImage(input).catch((reason: Error) => reason)
    expect(String(error)).not.toContain('audit-fake')
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it('拒绝伪装为PNG的SVG内容', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<svg onload="bad()"/>', { headers: { 'content-type': 'image/png' } })))
    await expect(getPanoramaImage(input)).rejects.toThrow('地图影像格式不受支持')
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it('真实文件签名与MIME必须一致', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(png, { headers: { 'content-type': 'image/jpeg' } })))
    await expect(getPanoramaImage(input)).rejects.toThrow()
  })
  it('相同并发请求仅一次上游并写入缓存', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(png, { headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetcher)
    const results = await Promise.all([getPanoramaImage(input), getPanoramaImage(input)])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(mocks.set).toHaveBeenCalledTimes(1)
    expect(results[0].contentType).toBe('image/png')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) })
  })
  it('有效缓存直接命中而旧非法内容不返回浏览器', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(png, { headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetcher)
    mocks.get.mockResolvedValueOnce(Buffer.from(png))
    expect((await getPanoramaImage(input)).cached).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
    mocks.get.mockResolvedValueOnce(Buffer.from('<svg/>'))
    expect((await getPanoramaImage(input)).cached).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('拒绝超过上限的声明响应并取消读取', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(9 * 1024 * 1024) } })))
    await expect(getPanoramaImage(input)).rejects.toThrow('地图图片超出大小限制')
    expect(mocks.set).not.toHaveBeenCalled()
  })
})

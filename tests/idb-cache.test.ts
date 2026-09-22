import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchBlobCached, selectCacheEvictions, setCacheUser } from '../app/utils/idb'

beforeEach(async () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('indexedDB', { open: () => { throw new Error('浏览器禁止存储') } })
  await setCacheUser(null)
})
afterEach(() => vi.unstubAllGlobals())

describe('缓存失败降级与身份隔离', () => {
  it('相同图片共享网络请求，取消一个订阅不影响另一个', async () => {
    await setCacheUser('user-a')
    let finish!: (blob: Blob) => void
    const body = new Promise<Blob>((resolve) => { finish = resolve })
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    let networkSignal: AbortSignal | undefined
    const fetcher = vi.fn().mockImplementation(async (_url, options) => {
      networkSignal = options.signal
      started()
      return { ok: true, blob: () => body }
    })
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    const first = fetchBlobCached('/api/shared-image', undefined, controller.signal)
    const rejected = expect(first).rejects.toThrow()
    const second = fetchBlobCached('/api/shared-image')
    await ready
    controller.abort()
    await rejected
    expect(networkSignal?.aborted).toBe(false)
    const image = new Blob(['shared'], { type: 'image/png' })
    finish(image)
    expect(await second).toBe(image)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('最后一个订阅取消后终止网络，新订阅可以重新发起请求', async () => {
    await setCacheUser('user-a')
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    let networkSignal: AbortSignal | undefined
    const fetcher = vi.fn().mockImplementationOnce(async (_url, options) => {
      networkSignal = options.signal
      started()
      return await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError'))))
    }).mockResolvedValue({ ok: true, blob: async () => new Blob(['retry'], { type: 'image/png' }) })
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    const first = fetchBlobCached('/api/cancel-shared', undefined, controller.signal)
    const rejected = expect(first).rejects.toThrow()
    await ready
    controller.abort()
    await rejected
    expect(networkSignal?.aborted).toBe(true)
    expect((await fetchBlobCached('/api/cancel-shared')).size).toBe(5)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('先清过期，再按访问时间满足字节与条目两种上限', () => {
    const entries = [
      { key: 'expired', expiresAt: 1, lastAccess: 10, bytes: 200 },
      { key: 'old', expiresAt: 999, lastAccess: 1, bytes: 70 },
      { key: 'recent', expiresAt: 999, lastAccess: 2, bytes: 70 },
    ]
    expect(selectCacheEvictions(entries, 100, 100, 300)).toEqual(['expired', 'old'])
    expect(selectCacheEvictions(entries, 100, 1000, 1)).toEqual(['expired', 'old'])
  })
  it('IndexedDB 不可用时仍请求并返回图片', async () => {
    await setCacheUser('user-a')
    const blob = new Blob(['image'], { type: 'image/png' })
    const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    vi.stubGlobal('fetch', fetcher)
    expect(await fetchBlobCached('/api/panorama?location=1,2')).toBe(blob)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('已取消的图片请求不发起网络调用', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    controller.abort()
    await expect(fetchBlobCached('/api/image', undefined, controller.signal)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('退出后不返回上一用户尚未完成的图片', async () => {
    await setCacheUser('user-a')
    let finish!: (value: Blob) => void
    const body = new Promise<Blob>((resolve) => { finish = resolve })
    let requested!: () => void
    const started = new Promise<void>((resolve) => { requested = resolve })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      requested()
      return { ok: true, blob: () => body }
    }))
    const pending = fetchBlobCached('/api/private-image')
    const result = expect(pending).rejects.toThrow('登录状态已变化')
    await started
    await setCacheUser(null)
    finish(new Blob(['private'], { type: 'image/png' }))
    await result
  })
  it('显式重试要求重新请求，普通加载不强制刷新浏览器缓存', async () => {
    await setCacheUser('user-a')
    const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['image'], { type: 'image/webp' }) })
    vi.stubGlobal('fetch', fetcher)
    await fetchBlobCached('/api/image')
    expect(fetcher.mock.calls[0]![1].cache).toBeUndefined()
    await fetchBlobCached('/api/image', undefined, undefined, true)
    expect(fetcher.mock.calls[1]![1].cache).toBe('reload')
  })
  it('HTTP200的非图片、空内容及解码失败不能成为可用缓存', async () => {
    await setCacheUser('user-a')
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['html'], { type: 'text/html' }) })
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob([], { type: 'image/png' }) })
      .mockResolvedValue({ ok: true, blob: async () => new Blob(['corrupt'], { type: 'image/png' }) })
    vi.stubGlobal('fetch', fetcher)
    await expect(fetchBlobCached('/api/bad-image')).rejects.toThrow('格式或大小')
    await expect(fetchBlobCached('/api/bad-image')).rejects.toThrow('格式或大小')
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')))
    await expect(fetchBlobCached('/api/bad-image')).rejects.toThrow('decode failed')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})

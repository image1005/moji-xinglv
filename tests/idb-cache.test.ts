import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchBlobCached, fetchJsonCached, setCacheUser } from '../app/utils/idb'

beforeEach(async () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('indexedDB', { open: () => { throw new Error('浏览器禁止存储') } })
  await setCacheUser(null)
})
afterEach(() => vi.unstubAllGlobals())

describe('缓存失败降级与身份隔离', () => {
  it('IndexedDB 不可用时仍请求并返回图片', async () => {
    await setCacheUser('user-a')
    const blob = new Blob(['image'], { type: 'image/png' })
    const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    vi.stubGlobal('fetch', fetcher)
    expect(await fetchBlobCached('/api/panorama?location=1,2')).toBe(blob)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('IndexedDB 不可用时仍返回 JSON，包括 false 值', async () => {
    await setCacheUser('user-a')
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(false))
    expect(await fetchJsonCached('/api/example')).toBe(false)
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
    finish(new Blob(['private']))
    await result
  })
})

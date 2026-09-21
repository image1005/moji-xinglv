import { wimgs } from 'tencentcloud-sdk-nodejs-wimgs'
import { createServer } from 'node:http'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { imageFailure } from '../server/providers/media-errors'
const stored = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../server/services/cache', () => ({ getCachedJson: async (key: string) => stored.get(key), setCachedJson: async (key: string, value: unknown) => { stored.set(key, value) } }))
let api: typeof import('../server/providers/tencent-images')
const record = { title: '太原晋祠实拍', siteName: '来源站点', siteUrl: 'https://example.org/travel', thumbnailUrl: 'https://img01.sogoucdn.com/image.jpg' }
beforeEach(async () => {
  vi.resetModules(); stored.clear()
  vi.stubEnv('MEDIA_IMAGE_SEARCH', 'tencent'); vi.stubEnv('MEDIA_IMAGE_SEARCH_HOURLY_LIMIT', '60')
  vi.stubEnv('TENCENTCLOUD_SECRET_ID', 'fixture-id'); vi.stubEnv('TENCENTCLOUD_SECRET_KEY', 'fixture-secret')
  api = await import('../server/providers/tencent-images')
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
it('验证 SDK 请求配置、Images 字符串数组与缓存合并', async () => {
  const request = vi.spyOn(wimgs.v20251106.Client.prototype, 'request').mockImplementation(async function (this: InstanceType<typeof wimgs.v20251106.Client>, action, input, options) {
    expect(action).toBe('SearchByText'); expect(input).toEqual({ Query: '太原 晋祠 实景' })
    expect(this.endpoint).toBe('wimgs.tencentcloudapi.com')
    expect(this.apiVersion).toBe('2025-11-06')
    expect(this.profile.signMethod).toBe('TC3-HMAC-SHA256')
    expect(options).toHaveProperty('signal')
    return { Images: [JSON.stringify(record), 'invalid-json'], RequestId: 'fixture' }
  })
  const [one, two] = await Promise.all([api.searchTencentImages('太原 晋祠 实景'), api.searchTencentImages('太原 晋祠 实景')])
  expect(one).toEqual([record]); expect(two).toEqual(one)
  await api.searchTencentImages('太原 晋祠 实景')
  expect(request).toHaveBeenCalledTimes(1)
})
it('空结果也缓存，重试不重复计费；进程小时额度耗尽阻止新查询', async () => {
  vi.stubEnv('MEDIA_IMAGE_SEARCH_HOURLY_LIMIT', '1')
  const request = vi.spyOn(wimgs.v20251106.Client.prototype, 'request').mockResolvedValue({ Images: [] })
  expect(await api.searchTencentImages('无图片')).toEqual([])
  expect(await api.searchTencentImages('无图片')).toEqual([])
  await expect(api.searchTencentImages('另一查询')).rejects.toMatchObject({ statusCode: 429 })
  expect(request).toHaveBeenCalledTimes(1)
})
it('未开通/无效密钥与限流有明确分类，异常不污染查询缓存', async () => {
  const request = vi.spyOn(wimgs.v20251106.Client.prototype, 'request').mockRejectedValue({ code: 'AuthFailure.SecretIdNotFound', message: 'private secret detail' })
  const error = await api.searchTencentImages('测试').catch(error => error)
  expect(imageFailure(error).code).toBe('configuration')
  expect(imageFailure(error).message).not.toContain('private')
  expect(stored.size).toBe(0)
  request.mockRejectedValue({ code: 'RequestLimitExceeded' })
  expect(imageFailure(await api.searchTencentImages('测试').catch(error => error)).code).toBe('rate_limited')
})
it('拒绝超过记录长度和数量约定的上游响应，不污染缓存', async () => {
  const request = vi.spyOn(wimgs.v20251106.Client.prototype, 'request').mockResolvedValue({ Images: ['x'.repeat(20001)] })
  expect(imageFailure(await api.searchTencentImages('测试').catch(error => error)).code).toBe('invalid_response')
  request.mockResolvedValue({ Images: Array.from({ length: 21 }, () => JSON.stringify(record)) })
  expect(imageFailure(await api.searchTencentImages('测试').catch(error => error)).code).toBe('invalid_response')
  expect(stored.size).toBe(0)
})
it('未配置和关闭时不发出请求；显式选择腾讯云但缺密钥会提示配置', async () => {
  const request = vi.spyOn(wimgs.v20251106.Client.prototype, 'request')
  vi.stubEnv('TENCENTCLOUD_SECRET_KEY', '')
  await expect(api.searchTencentImages('测试')).rejects.toMatchObject({ data: { mediaConfiguration: true } })
  vi.stubEnv('MEDIA_IMAGE_SEARCH', 'auto')
  expect(await api.searchTencentImages('测试')).toEqual([])
  vi.stubEnv('MEDIA_IMAGE_SEARCH', 'off')
  expect(await api.searchTencentImages('测试')).toEqual([])
  expect(request).not.toHaveBeenCalled()
})
it('真实 SDK 在隔离 HTTP 服务完成签名、序列化及腾讯错误响应解析', async () => {
  const received: Array<{ action: string | string[] | undefined; version: string | string[] | undefined; signed: boolean; body: string }> = []
  let failure = false
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk.toString()
    received.push({ action: request.headers['x-tc-action'], version: request.headers['x-tc-version'], signed: request.headers.authorization?.startsWith('TC3-HMAC-SHA256') ?? false, body })
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ Response: failure ? { Error: { Code: 'AuthFailure.SecretIdNotFound', Message: 'fixture-only' }, RequestId: 'fixture' } : { Images: [JSON.stringify(record)], RequestId: 'fixture' } }))
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const original = wimgs.v20251106.Client.prototype.request
  vi.spyOn(wimgs.v20251106.Client.prototype, 'request').mockImplementation(function (this: InstanceType<typeof wimgs.v20251106.Client>, ...args) {
    this.endpoint = `127.0.0.1:${address.port}`
    this.profile.httpProfile = { ...this.profile.httpProfile, protocol: 'http://' }
    return original.apply(this, args)
  })
  try {
    expect(await api.searchTencentImages('太原 晋祠 实景')).toEqual([record])
    expect(received[0]).toEqual({ action: 'SearchByText', version: '2025-11-06', signed: true, body: JSON.stringify({ Query: '太原 晋祠 实景' }) })
    failure = true
    expect(imageFailure(await api.searchTencentImages('另一查询').catch(error => error)).code).toBe('configuration')
  } finally { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())) }
})

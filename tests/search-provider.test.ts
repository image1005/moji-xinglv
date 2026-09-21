import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configuredSearchProvider, searchWeb } from '../server/providers/search'
import { modelCapabilities, validateModelConfiguration } from '../server/providers/models'

beforeEach(() => {
  vi.stubEnv('AI_PROVIDER', 'deepseek'); vi.stubEnv('AI_MODEL', 'deepseek-flash')
  vi.stubEnv('AI_API_KEY', 'fixture-only'); vi.stubEnv('AI_BASE_URL', 'https://api.deepseek.com/v1')
  vi.stubEnv('TAVILY_API_KEY', ''); vi.stubEnv('AI_SEARCH_PROVIDER', 'auto')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('联网供应商选择与真实协议适配', () => {
  it('官方密钥无需 Tavily 即启用搜索；本轮快照由服务端确定实际提供方', () => {
    expect(modelCapabilities().search).toEqual({ available: true, native: true, provider: 'DeepSeek' })
    expect(validateModelConfiguration({ model: 'deepseek-flash', webSearch: true, thinking: 'light', searchProvider: 'Tavily' }).searchProvider).toBe('DeepSeek')
    expect(validateModelConfiguration({ model: 'deepseek-flash', webSearch: false, thinking: 'light', searchProvider: 'DeepSeek' }).searchProvider).toBeUndefined()
    vi.stubEnv('TAVILY_API_KEY', 'fixture-tavily')
    expect(configuredSearchProvider()).toBe('Tavily')
    vi.stubEnv('AI_SEARCH_PROVIDER', 'deepseek')
    expect(configuredSearchProvider()).toBe('DeepSeek')
    vi.stubEnv('AI_SEARCH_PROVIDER', 'off')
    expect(modelCapabilities().search.available).toBe(false)
  })
  it('兼容网关密钥不能发送到官方搜索；空白密钥不启用能力', () => {
    vi.stubEnv('AI_BASE_URL', 'https://gateway.example/v1')
    expect(configuredSearchProvider()).toBeNull()
    vi.stubEnv('AI_BASE_URL', 'https://api.deepseek.com/v1'); vi.stubEnv('AI_API_KEY', '  ')
    expect(configuredSearchProvider()).toBeNull()
  })
  it('只采用真实搜索结果，保留引用摘要，不把正文链接或加密内容当成来源', async () => {
    const fetcher = vi.fn(async () => Response.json({ content: [
      { type: 'text', text: 'https://invented.example', citations: [{ url: 'https://example.org/place', cited_text: '实测引用摘要' }] },
      { type: 'web_search_tool_result', content: [
        { type: 'web_search_result', title: '地点资料', url: 'https://example.org/place', encrypted_content: 'private-encrypted-content' },
        { type: 'web_search_result', title: '另一个来源', url: 'https://example.org/other' },
        { type: 'web_search_result', title: '重复', url: 'https://example.org/place' },
      ] },
    ] }))
    vi.stubGlobal('fetch', fetcher)
    const result = await searchWeb('杭州')
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ provider: 'DeepSeek', url: 'https://example.org/place', summary: '实测引用摘要' })
    expect(result[1]!.summary).toBe('')
    expect(JSON.stringify(result)).not.toMatch(/invented|encrypted/)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/anthropic/v1/messages')
    expect(JSON.parse(String(init.body))).toMatchObject({ thinking: { type: 'disabled' }, tools: [{ name: 'web_search', type: 'web_search_20250305', max_uses: 1 }] })
  })
  it('上游未搜索或搜索错误不显示成功；取消后不发请求', async () => {
    const fetcher = vi.fn(async () => Response.json({ content: [{ type: 'text', text: '声称搜索完成' }] }))
    vi.stubGlobal('fetch', fetcher)
    await expect(searchWeb('杭州')).rejects.toThrow('未返回可验证来源')
    const controller = new AbortController(); controller.abort()
    await expect(searchWeb('杭州', controller.signal)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

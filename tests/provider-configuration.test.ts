import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamText } from 'ai'
import { createConfiguredModel, modelCapabilities, validateModelConfiguration } from '../server/providers/models'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('实际供应商配置', () => {
  it('只为已知官方模型启用能力；兼容服务不能只凭名字得到视觉', () => {
    vi.stubEnv('AI_BASE_URL', 'https://api.deepseek.com')
    vi.stubEnv('AI_PROVIDER', '')
    expect(modelCapabilities('deepseek-flash')).toMatchObject({ vision: true, thinkingLevels: ['off', 'light', 'standard', 'deep'] })
    vi.stubEnv('AI_BASE_URL', 'https://other.example/v1')
    vi.stubEnv('AI_SUPPORTS_VISION', '')
    expect(modelCapabilities('deepseek-flash')).toMatchObject({ vision: false, thinkingLevels: ['off'] })
  })
  it('禁用缺少配置的搜索，不接受任意模型', () => {
    vi.stubEnv('AI_MODEL', 'deepseek-flash'); vi.stubEnv('AI_PROVIDER', 'deepseek'); vi.stubEnv('TAVILY_API_KEY', '')
    vi.stubEnv('AI_API_KEY', '')
    expect(() => validateModelConfiguration({ model: 'deepseek-flash', webSearch: true, thinking: 'off' })).toThrow('TAVILY_API_KEY')
    expect(() => validateModelConfiguration({ model: 'arbitrary-model', webSearch: false, thinking: 'off' })).toThrow('未在服务端启用')
  })
  it.each([['off', undefined], ['light', 'low'], ['standard', 'high'], ['deep', 'max']] as const)('SDK实际请求映射%s思考参数且不影响正文', async (thinking, effort) => {
    vi.stubEnv('AI_PROVIDER', 'deepseek'); vi.stubEnv('AI_API_KEY', 'fixture-only'); vi.stubEnv('AI_BASE_URL', 'https://api.deepseek.com')
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', async (_url: unknown, request: RequestInit) => {
      body = JSON.parse(String(request.body))
      const chunk = { id: 'fixture', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: { content: '测试' }, finish_reason: 'stop' }] }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    })
    const model = createConfiguredModel({ model: 'deepseek-flash', thinking, webSearch: false })
    if ('id' in model) throw new Error('Unexpected fallback provider')
    expect(await streamText({ model, prompt: '旅行测试' }).text).toBe('测试')
    expect(body.thinking).toEqual({ type: thinking === 'off' ? 'disabled' : 'enabled' })
    expect(body.reasoning_effort).toBe(effort)
  })
})

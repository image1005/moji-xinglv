import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelConfiguration } from '../shared/schemas/model-config'

const storage = vi.hoisted(() => ({ value: undefined as ModelConfiguration | undefined, writes: 0 }))
vi.mock('../server/utils/db', () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ get: () => storage.value ? { configurationJson: storage.value } : undefined }) }) }),
  insert: () => ({ values: (input: { configurationJson: ModelConfiguration }) => ({ onConflictDoUpdate: () => ({ run: () => { storage.value = input.configurationJson; storage.writes++ } }) }) }),
} }))
const { getModelSettings, resolveModelConfiguration, saveModelSettings } = await import('../server/services/model-settings')

afterEach(() => { vi.unstubAllEnvs(); storage.value = undefined; storage.writes = 0 })

describe('模型偏好保存与运行快照', () => {
  it('完整保存各档和搜索组合，读取与本轮快照一致且不与外部对象共用', () => {
    vi.stubEnv('AI_PROVIDER', 'deepseek'); vi.stubEnv('AI_BASE_URL', 'https://api.deepseek.com/v1'); vi.stubEnv('AI_MODEL', 'deepseek-chat')
    vi.stubEnv('AI_API_KEY', 'fixture-only'); vi.stubEnv('AI_SEARCH_PROVIDER', 'deepseek')
    for (const thinking of ['off', 'light', 'standard', 'deep'] as const) {
      for (const webSearch of [false, true]) {
        const input = { model: 'deepseek-chat', thinking, webSearch }
        const saved = saveModelSettings('user', input)
        const restored = getModelSettings('user')
        const snapshot = resolveModelConfiguration('user')
        expect(saved).toEqual(restored)
        expect(snapshot).toEqual(restored.defaults)
        expect(snapshot).toMatchObject({ model: 'deepseek-flash', thinking, webSearch })
        expect(snapshot.searchProvider).toBe(webSearch ? 'DeepSeek' : undefined)
        input.webSearch = !webSearch
        expect(snapshot.webSearch).toBe(webSearch)
        expect(saved.adjustmentReason).toBeUndefined()
      }
    }
    expect(storage.writes).toBe(8)
  })
  it('接口能力变化后解释旧偏好的调整，发送或保存不支持的档位明确拒绝', () => {
    vi.stubEnv('AI_PROVIDER', 'deepseek'); vi.stubEnv('AI_BASE_URL', 'https://other.example/v1'); vi.stubEnv('AI_MODEL', 'deepseek-flash')
    vi.stubEnv('AI_DEEPSEEK_THINKING_LEVELS', ''); vi.stubEnv('AI_SEARCH_PROVIDER', 'off')
    storage.value = { model: 'deepseek-flash', thinking: 'deep', webSearch: true }
    expect(getModelSettings('user')).toMatchObject({ defaults: { thinking: 'off', webSearch: false }, adjustmentReason: expect.stringContaining('原保存的「深度思考」') })
    expect(getModelSettings('user').adjustmentReason).toContain('联网搜索当前不可用')
    expect(() => resolveModelConfiguration('user', storage.value)).toThrow('不支持此思考深度')
    expect(() => saveModelSettings('user', storage.value)).toThrow('不支持此思考深度')
    expect(storage.writes).toBe(0)
    expect(storage.value.thinking).toBe('deep')
  })
})

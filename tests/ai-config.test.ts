import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiConfig } from '../server/utils/ai-config'

afterEach(() => vi.unstubAllEnvs())

describe('AI 有界思考预算与期限', () => {
  it('保留非思考额度，思考独立保留正文与工具所需空间，期限不默认延长', () => {
    vi.stubEnv('AI_OUTPUT_MAX_TOKENS', undefined)
    vi.stubEnv('AI_THINKING_OUTPUT_MAX_TOKENS', undefined)
    vi.stubEnv('AI_RUN_TIMEOUT_MS', undefined)
    vi.stubEnv('AI_REASONING_MAX_BYTES', undefined)
    expect(aiConfig()).toMatchObject({ AI_OUTPUT_MAX_TOKENS: 4096, AI_THINKING_OUTPUT_MAX_TOKENS: 32768, AI_RUN_TIMEOUT_MS: 180000, AI_REASONING_MAX_BYTES: 262144 })
  })
  it('明确配置可调整但不允许无限等待或无界输出', () => {
    vi.stubEnv('AI_THINKING_OUTPUT_MAX_TOKENS', '65536'); vi.stubEnv('AI_RUN_TIMEOUT_MS', '5000')
    expect(aiConfig()).toMatchObject({ AI_THINKING_OUTPUT_MAX_TOKENS: 65536, AI_RUN_TIMEOUT_MS: 5000 })
    vi.stubEnv('AI_THINKING_OUTPUT_MAX_TOKENS', '131073')
    expect(() => aiConfig()).toThrow()
    vi.stubEnv('AI_THINKING_OUTPUT_MAX_TOKENS', '32768'); vi.stubEnv('AI_RUN_TIMEOUT_MS', '600001')
    expect(() => aiConfig()).toThrow()
    vi.stubEnv('AI_RUN_TIMEOUT_MS', '180000'); vi.stubEnv('AI_REASONING_MAX_BYTES', '2097153')
    expect(() => aiConfig()).toThrow()
  })
})

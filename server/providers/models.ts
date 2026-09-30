import { createDeepSeek } from '@ai-sdk/deepseek'
import { defaultSettingsMiddleware, wrapLanguageModel } from 'ai'
import { createError } from 'h3'
import type { ModelCapabilities, ModelConfiguration } from '../../shared/schemas/model-config'
import { configuredSearchProvider } from './search'
import { preserveToolReasoning } from './reasoning-replay'

// Official endpoint probe on 2026-09-18 confirmed deepseek-chat now returns deepseek-flash.
// Resolve this verified alias before persistence so request identity records the effective model.
export const canonicalModel = (model: string) => isOfficialDeepSeek() && model === 'deepseek-chat' ? 'deepseek-flash' : model
export const configuredModel = () => canonicalModel(process.env.AI_MODEL || 'deepseek-flash')
function isDeepSeek() {
  const provider = process.env.AI_PROVIDER
  if (provider) return provider === 'deepseek'
  try { return new URL(process.env.AI_BASE_URL || 'https://api.deepseek.com').hostname === 'api.deepseek.com' } catch { return false }
}
export function isOfficialDeepSeek() {
  try { return isDeepSeek() && new URL(process.env.AI_BASE_URL || 'https://api.deepseek.com').origin === 'https://api.deepseek.com' } catch { return false }
}
const thinkingLevels = ['off', 'light', 'standard', 'deep'] as const
function configuredThinkingLevels(): ModelCapabilities['thinkingLevels'] {
  if (!isDeepSeek() || !process.env.AI_DEEPSEEK_THINKING_LEVELS?.trim()) return ['off']
  const configured = process.env.AI_DEEPSEEK_THINKING_LEVELS.split(',').map(value => value.trim())
  if (configured.some(value => !thinkingLevels.some(level => level === value))) throw createError({ statusCode: 503, statusMessage: '服务端思考档位配置无效，请检查 AI_DEEPSEEK_THINKING_LEVELS' })
  return thinkingLevels.filter(level => configured.includes(level))
}
/** Compatibility gateways must explicitly opt into capabilities; model names alone are not evidence. */
export function modelCapabilities(model = configuredModel()): ModelCapabilities {
  const official = isOfficialDeepSeek()
  const modern = official && ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro'].includes(model)
  const supportedThinking = modern ? [...thinkingLevels] : official ? model === 'deepseek-reasoner' ? ['standard'] as const : ['off'] as const : configuredThinkingLevels()
  const searchProvider = configuredSearchProvider()
  return {
    model, provider: official ? 'DeepSeek' : 'OpenAI-compatible',
    vision: (modern && model !== 'deepseek-v4-pro') || (!official && process.env.AI_SUPPORTS_VISION === 'true'), tools: true,
    thinkingLevels: [...supportedThinking],
    ...(supportedThinking.length < thinkingLevels.length ? { thinkingUnavailableReason: official ? model === 'deepseek-reasoner' ? '该历史模型仅提供固定的标准思考；其他档位与关闭思考不可用。' : '此模型没有已核实的思考档位支持，请使用已启用的 DeepSeek Flash 模型。' : '当前接口未声明支持这些思考档位；需由服务端核实 DeepSeek 参数与工具续传能力后启用。' } : {}),
    search: { available: Boolean(searchProvider), provider: searchProvider, native: searchProvider === 'DeepSeek',
      ...(!searchProvider ? { unavailableReason: process.env.AI_SEARCH_PROVIDER === 'off' ? '服务端已关闭联网搜索。' : '尚未配置可用的官方 DeepSeek 搜索或 Tavily 搜索服务。' } : {}),
    },
    verification: official ? 'documented' : 'configured',
  }
}
export function validateModelConfiguration(config: ModelConfiguration) {
  config = { ...config, model: canonicalModel(config.model) }
  const allowed = new Set([configuredModel(), ...(isOfficialDeepSeek() ? ['deepseek-flash'] : [])])
  if (!allowed.has(config.model)) throw createError({ statusCode: 400, statusMessage: '该模型未在服务端启用' })
  const capabilities = modelCapabilities(config.model)
  if (!capabilities.thinkingLevels.includes(config.thinking)) throw createError({ statusCode: 400, statusMessage: `所选模型不支持此思考深度。${capabilities.thinkingUnavailableReason ?? ''}` })
  if (config.webSearch && !capabilities.search.available) throw createError({ statusCode: 503, statusMessage: '联网搜索未配置：需要官方 DeepSeek 密钥或 TAVILY_API_KEY，请检查 AI_SEARCH_PROVIDER' })
  const { searchProvider: _previous, ...rest } = config
  return config.webSearch ? { ...rest, searchProvider: configuredSearchProvider()! } : rest
}
function deepseekOptions(config: ModelConfiguration) {
  return { deepseek: {
    thinking: { type: config.thinking === 'off' ? 'disabled' : 'enabled' },
    ...(config.thinking !== 'off' ? { reasoningEffort: { light: 'low', standard: 'high', deep: 'max' }[config.thinking] } : {}),
  } }
}
export function createConfiguredModel(config: ModelConfiguration) {
  if (isDeepSeek()) {
    const model = createDeepSeek({ apiKey: process.env.AI_API_KEY, baseURL: process.env.AI_BASE_URL || 'https://api.deepseek.com' })(config.model)
    return wrapLanguageModel({ model, middleware: [defaultSettingsMiddleware({ settings: { providerOptions: deepseekOptions(config) } }), preserveToolReasoning()] })
  }
  const id: `custom/${string}` = `custom/${config.model}`
  return { id, url: process.env.AI_BASE_URL || 'https://api.openai.com/v1', apiKey: process.env.AI_API_KEY }
}

import { createDeepSeek } from '@ai-sdk/deepseek'
import { defaultSettingsMiddleware, wrapLanguageModel } from 'ai'
import { createError } from 'h3'
import type { ModelCapabilities, ModelConfiguration } from '../../shared/schemas/model-config'
import { configuredSearchProvider } from './search'

// Official endpoint probe on 2026-09-18 confirmed deepseek-chat now returns deepseek-flash.
// Resolve this verified alias before persistence so request identity records the effective model.
const canonicalModel = (model: string) => isDeepSeek() && model === 'deepseek-chat' ? 'deepseek-flash' : model
export const configuredModel = () => canonicalModel(process.env.AI_MODEL || 'deepseek-flash')
export function isDeepSeek() {
  const provider = process.env.AI_PROVIDER
  if (provider) return provider === 'deepseek'
  try { return new URL(process.env.AI_BASE_URL || 'https://api.deepseek.com').hostname === 'api.deepseek.com' } catch { return false }
}
/** Compatibility gateways must explicitly opt into capabilities; model names alone are not evidence. */
export function modelCapabilities(model = configuredModel()): ModelCapabilities {
  const official = isDeepSeek()
  const modern = official && ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro'].includes(model)
  const searchProvider = configuredSearchProvider()
  return {
    model, provider: official ? 'DeepSeek' : 'OpenAI-compatible',
    vision: modern || (!official && process.env.AI_SUPPORTS_VISION === 'true'), tools: true,
    thinkingLevels: modern ? ['off', 'light', 'standard', 'deep'] : model === 'deepseek-reasoner' && official ? ['standard'] : ['off'],
    search: { available: Boolean(searchProvider), provider: searchProvider, native: searchProvider === 'DeepSeek' },
    verification: official ? 'documented' : 'configured',
  }
}
export function validateModelConfiguration(config: ModelConfiguration) {
  config = { ...config, model: canonicalModel(config.model) }
  const allowed = new Set([configuredModel(), ...(isDeepSeek() ? ['deepseek-flash'] : [])])
  if (!allowed.has(config.model)) throw createError({ statusCode: 400, statusMessage: '该模型未在服务端启用' })
  const capabilities = modelCapabilities(config.model)
  if (!capabilities.thinkingLevels.includes(config.thinking)) throw createError({ statusCode: 400, statusMessage: '所选模型不支持此思考深度' })
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
    return wrapLanguageModel({ model, middleware: defaultSettingsMiddleware({ settings: { providerOptions: deepseekOptions(config) } }) })
  }
  const id: `custom/${string}` = `custom/${config.model}`
  return { id, url: process.env.AI_BASE_URL || 'https://api.openai.com/v1', apiKey: process.env.AI_API_KEY }
}

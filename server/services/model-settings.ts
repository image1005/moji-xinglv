import { eq } from 'drizzle-orm'
import { ModelConfigurationSchema, type ModelConfiguration } from '../../shared/schemas/model-config'
import { modelSettings } from '../database/schema'
import { db } from '../utils/db'
import { canonicalModel, configuredModel, isOfficialDeepSeek, modelCapabilities, validateModelConfiguration } from '../providers/models'

export function getModelSettings(userId: string) {
  const stored = db.select().from(modelSettings).where(eq(modelSettings.userId, userId)).get()
  const parsed = ModelConfigurationSchema.safeParse(stored?.configurationJson)
  const allowed = new Set([configuredModel(), ...(isOfficialDeepSeek() ? ['deepseek-flash'] : [])])
  const storedModel = parsed.success ? canonicalModel(parsed.data.model) : undefined
  const model = storedModel && allowed.has(storedModel) ? storedModel : configuredModel()
  const capabilities = modelCapabilities(model)
  const defaults = parsed.success ? { ...parsed.data, model } : { model, webSearch: false, thinking: capabilities.thinkingLevels[0]! }
  const adjustments: string[] = []
  if (storedModel && storedModel !== model) adjustments.push('原保存模型已停用，当前使用服务端启用的模型')
  // Restored preferences may no longer be available; explain every adjustment before the next send.
  if (!capabilities.thinkingLevels.includes(defaults.thinking)) {
    const labels = { off: '关闭', light: '轻量', standard: '标准', deep: '深度' }
    const previous = defaults.thinking
    defaults.thinking = capabilities.thinkingLevels[0]!
    adjustments.push(`原保存的「${labels[previous]}思考」不再受当前接口支持，当前已设为「${labels[defaults.thinking]}」`)
  }
  if (!capabilities.search.available && defaults.webSearch) {
    defaults.webSearch = false
    adjustments.push('原保存的联网搜索当前不可用，已关闭联网')
  }
  return { defaults: validateModelConfiguration(defaults), capabilities, ...(adjustments.length ? { adjustmentReason: `${adjustments.join('；')}。请确认后再发送。` } : {}) }
}
export function resolveModelConfiguration(userId: string, input?: unknown): ModelConfiguration {
  return validateModelConfiguration(ModelConfigurationSchema.parse(input ?? getModelSettings(userId).defaults))
}
export function saveModelSettings(userId: string, input: unknown) {
  const configuration = resolveModelConfiguration(userId, input)
  db.insert(modelSettings).values({ userId, configurationJson: configuration }).onConflictDoUpdate({ target: modelSettings.userId, set: { configurationJson: configuration, updatedAt: new Date() } }).run()
  return getModelSettings(userId)
}

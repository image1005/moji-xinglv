import { eq } from 'drizzle-orm'
import { ModelConfigurationSchema, type ModelConfiguration } from '../../shared/schemas/model-config'
import { modelSettings } from '../database/schema'
import { db } from '../utils/db'
import { configuredModel, isDeepSeek, modelCapabilities, validateModelConfiguration } from '../providers/models'

export function getModelSettings(userId: string) {
  const stored = db.select().from(modelSettings).where(eq(modelSettings.userId, userId)).get()
  const parsed = ModelConfigurationSchema.safeParse(stored?.configurationJson)
  const allowed = new Set([configuredModel(), ...(isDeepSeek() ? ['deepseek-flash'] : [])])
  const model = parsed.success && allowed.has(parsed.data.model) ? parsed.data.model : configuredModel()
  const capabilities = modelCapabilities(model)
  const defaults = parsed.success ? { ...parsed.data, model } : { model, webSearch: false, thinking: capabilities.thinkingLevels[0]! }
  // Provider configuration changes must not silently preserve unsupported preferences.
  if (!capabilities.thinkingLevels.includes(defaults.thinking)) defaults.thinking = capabilities.thinkingLevels[0]!
  if (!capabilities.search.available) defaults.webSearch = false
  return { defaults: validateModelConfiguration(defaults), capabilities }
}
export function resolveModelConfiguration(userId: string, input?: unknown): ModelConfiguration {
  return validateModelConfiguration(ModelConfigurationSchema.parse(input ?? getModelSettings(userId).defaults))
}
export function saveModelSettings(userId: string, input: unknown) {
  const configuration = resolveModelConfiguration(userId, input)
  db.insert(modelSettings).values({ userId, configurationJson: configuration }).onConflictDoUpdate({ target: modelSettings.userId, set: { configurationJson: configuration, updatedAt: new Date() } }).run()
  return getModelSettings(userId)
}

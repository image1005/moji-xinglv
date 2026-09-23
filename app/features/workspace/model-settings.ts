import { ref } from 'vue'
import { ModelConfigurationSchema, ModelSettingsSchema, type ModelConfiguration, type ModelCapabilities } from '#shared/schemas/model-config'
import { apiErrorMessage } from '~/utils/api'

/** User defaults are persisted by the server; one immutable copy belongs to each turn. */
export function createModelSettings() {
  const configuration = ref<ModelConfiguration | null>(null)
  const capabilities = ref<ModelCapabilities | null>(null)
  const failure = ref('')
  const saving = ref(false)
  let generation = 0
  let change = 0
  let pending: Promise<void> | null = null
  let saveQueue = Promise.resolve()

  async function load(force = false) {
    if (configuration.value && !force) return
    if (pending) return pending
    const epoch = generation
    pending = (async () => {
      try {
        const value = ModelSettingsSchema.parse(await $fetch('/api/model-settings'))
        if (epoch !== generation) return
        configuration.value = value.defaults
        capabilities.value = value.capabilities
        failure.value = ''
      } catch (error) {
        if (epoch === generation) failure.value = apiErrorMessage(error, '无法读取模型能力，请重试')
      } finally { if (epoch === generation) pending = null }
    })()
    return pending
  }

  function update(patch: Partial<ModelConfiguration>) {
    if (!configuration.value || !capabilities.value) return
    const next = ModelConfigurationSchema.parse({ ...configuration.value, ...patch })
    const caps = capabilities.value
    if (!caps.thinkingLevels.includes(next.thinking) || next.webSearch && !caps.search.available) return
    configuration.value = next
    const epoch = generation
    const token = ++change
    saving.value = true
    failure.value = ''
    saveQueue = saveQueue.then(async () => {
      if (epoch !== generation) return
      try {
        const saved = ModelSettingsSchema.parse(await $fetch('/api/model-settings', { method: 'PUT', body: next }))
        if (epoch === generation && token === change) {
          configuration.value = saved.defaults
          capabilities.value = saved.capabilities
        }
      } catch (error) {
        if (epoch === generation && token === change) failure.value = apiErrorMessage(error, '默认配置保存失败，本轮仍使用当前选择')
      } finally { if (epoch === generation && token === change) saving.value = false }
    })
  }

  async function snapshot() {
    await load()
    if (!configuration.value) throw new Error(failure.value || '模型能力尚未加载')
    return ModelConfigurationSchema.parse(configuration.value)
  }

  function reset() {
    generation++
    change++
    configuration.value = null
    capabilities.value = null
    saving.value = false
    failure.value = ''
    pending = null
  }
  return { configuration, capabilities, failure, saving, load, update, snapshot, reset }
}

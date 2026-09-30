<script setup lang="ts">
defineProps<{ disabled: boolean }>()
const { modelSettings } = useWorkspace()
const { configuration, capabilities, failure, adjustmentReason, saving } = modelSettings
const descriptionId = `model-capabilities-${useId()}`
const searchDescription = computed(() => {
  const search = capabilities.value?.search
  if (!search) return '正在读取模型能力…'
  if (!search.available) return search.unavailableReason || '尚未配置可用的搜索服务，智能搜索暂不可用'
  return search.native ? '联网由 DeepSeek 官方搜索提供' : `联网由 ${search.provider} 独立搜索工具提供`
})
onMounted(() => { void modelSettings.load() })
</script>

<template>
  <div class="chat-configuration">
    <div class="chat-configuration__fields">
      <ChatThinkingMenu :value="configuration?.thinking ?? 'off'" :levels="capabilities?.thinkingLevels ?? []" :disabled="disabled || !capabilities" :unavailable-reason="capabilities?.thinkingUnavailableReason" @change="modelSettings.update({ thinking: $event })" />
      <ChatSearchToggle :enabled="configuration?.webSearch ?? false" :available="capabilities?.search.available ?? false" :disabled="disabled || !capabilities" :description-id="descriptionId" @change="modelSettings.update({ webSearch: $event })" />
      <span v-if="configuration" class="chat-configuration__model" :title="configuration.model">{{ configuration.model }}</span>
      <span v-if="saving" class="chat-configuration__saving" role="status">正在保存…</span>
    </div>
    <p :id="descriptionId">{{ searchDescription }}<template v-if="capabilities"> · {{ capabilities.vision ? '支持图片理解' : '当前模型不支持图片理解' }}</template></p>
    <p v-if="adjustmentReason" class="chat-configuration__adjustment" role="status">{{ adjustmentReason }}</p>
    <p v-if="failure" class="chat-configuration__failure" role="alert">
      {{ failure }}<template v-if="configuration">；当前选择尚未保存，刷新后可能恢复上次配置。</template>
      <button v-if="configuration" type="button" :disabled="saving" @click="modelSettings.update({})">重试保存</button>
      <button v-else type="button" @click="modelSettings.load(true)">重新加载</button>
    </p>
  </div>
</template>

<style scoped>
.chat-configuration { color: var(--text-muted); font-size: 11px; padding: 8px 2px; }
.chat-configuration__fields { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.chat-configuration p { margin: 7px 0 0; line-height: 1.6; }
.chat-configuration__model { overflow: hidden; max-width: 160px; text-overflow: ellipsis; white-space: nowrap; margin-left: auto; }
.chat-configuration__saving { color: var(--bamboo); }
.chat-configuration__adjustment { color: var(--gold-deep); }
.chat-configuration__failure { color: var(--cinnabar); }
.chat-configuration__failure button { padding: 3px 6px; background: transparent; border: 0; color: var(--cinnabar); text-decoration: underline; font: inherit; cursor: pointer; }
@media (max-width: 480px) { .chat-configuration__model { max-width: 100%; margin-left: 0; } }
</style>

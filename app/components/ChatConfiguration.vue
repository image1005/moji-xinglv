<script setup lang="ts">
import type { ModelConfiguration } from '#shared/schemas/model-config'

defineProps<{ disabled: boolean }>()
const { modelSettings } = useWorkspace()
const { configuration, capabilities, failure, saving } = modelSettings
const levels = [{ value: 'off', label: '关闭' }, { value: 'light', label: '轻量' }, { value: 'standard', label: '标准' }, { value: 'deep', label: '深度' }] as const
onMounted(() => { void modelSettings.load() })
function thinkingChanged(event: Event) { modelSettings.update({ thinking: (event.target as HTMLSelectElement).value as ModelConfiguration['thinking'] }) }
</script>

<template>
  <div class="chat-configuration">
    <div class="chat-configuration__fields">
      <label><input type="checkbox" :checked="configuration?.webSearch ?? false" :disabled="disabled || !capabilities?.search.available" @change="modelSettings.update({ webSearch: ($event.target as HTMLInputElement).checked })">联网搜索</label>
      <label>思考深度<select aria-label="思考深度" :value="configuration?.thinking ?? 'off'" :disabled="disabled || !capabilities" @change="thinkingChanged"><option v-for="level in levels" :key="level.value" :value="level.value" :disabled="!capabilities?.thinkingLevels.includes(level.value)">{{ level.label }}{{ capabilities && !capabilities.thinkingLevels.includes(level.value) ? '（不支持）' : '' }}</option></select></label>
      <span v-if="configuration" class="chat-configuration__model">{{ configuration.model }}</span>
      <span v-if="saving" role="status">保存默认选择…</span>
    </div>
    <p v-if="capabilities">{{ capabilities.search.available ? `联网由 ${capabilities.search.provider} 独立搜索工具提供` : '联网搜索尚未配置' }} · {{ capabilities.vision ? '支持图片理解' : '当前模型不支持图片理解' }}</p>
    <p v-if="failure" role="alert">{{ failure }} <button type="button" @click="modelSettings.load(true)">重新加载</button></p>
  </div>
</template>

<style scoped>
.chat-configuration { color: var(--text-muted); font-size: 11px; padding: 8px 2px; }
.chat-configuration__fields { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; }
.chat-configuration label { display: inline-flex; gap: 6px; align-items: center; white-space: nowrap; }
.chat-configuration input { accent-color: var(--bamboo); }
.chat-configuration select { max-width: 130px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-primary); padding: 4px 6px; border-radius: 4px; }
.chat-configuration p { margin: 7px 0 0; line-height: 1.6; }
.chat-configuration__model { overflow: hidden; max-width: 160px; text-overflow: ellipsis; }
.chat-configuration button { background: transparent; border: 0; color: var(--cinnabar); cursor: pointer; }
</style>

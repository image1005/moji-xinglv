<script setup lang="ts">
const props = defineProps<{
  name: string
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
}>()

const LABELS: Record<string, string> = {
  get_plan: '读取行程',
  apply_plan_edits: '编辑行程',
  patch_plan_json: '修改行程',
  get_panorama: '获取街景',
  search_poi: '检索地点',
}

const label = computed(() => LABELS[props.name] ?? props.name)
const stateLabel = computed(() => {
  switch (props.state) {
    case 'input-streaming':
    case 'input-available':
      return '进行中'
    case 'output-available':
      return '完成'
    case 'output-error':
      return '出错'
    default:
      return props.state ?? ''
  }
})

function pretty(value: unknown): string {
  if (value === undefined || value === null) return ''
  const text = JSON.stringify(value, null, 2)
  return text.length > 2400 ? `${text.slice(0, 2400)}\n…（截断）` : text
}
</script>

<template>
  <details class="tool-call" :class="{ 'tool-call--error': state === 'output-error' }">
    <summary class="tool-call__summary">
      <span class="tool-call__name">{{ label }}</span>
      <span class="tool-call__state">{{ stateLabel }}</span>
    </summary>
    <div class="tool-call__body">
      <div v-if="input" class="tool-call__section">
        <div class="tool-call__label">参数</div>
        <pre><code>{{ pretty(input) }}</code></pre>
      </div>
      <div v-if="output" class="tool-call__section">
        <div class="tool-call__label">结果</div>
        <pre><code>{{ pretty(output) }}</code></pre>
      </div>
      <div v-if="errorText" class="tool-call__error">{{ errorText }}</div>
    </div>
  </details>
</template>

<style scoped>
.tool-call {
  margin-top: 6px;
  border: 1px dashed var(--line);
  border-radius: 3px;
  background: var(--paper);
  max-width: 560px;
}
.tool-call__summary {
  cursor: pointer;
  padding: 5px 10px;
  font-size: 12px;
  color: var(--ink-faint);
  display: flex;
  gap: 8px;
  align-items: center;
  list-style: none;
}
.tool-call__name {
  color: var(--bamboo);
}
.tool-call__state {
  margin-left: auto;
}
.tool-call__body {
  border-top: 1px dashed var(--line-soft);
  padding: 8px 10px;
}
.tool-call__label {
  font-size: 11px;
  color: var(--gold-deep);
  letter-spacing: 0.15em;
  margin-bottom: 4px;
}
.tool-call pre {
  margin: 0 0 8px;
  background: var(--paper-deep);
  border-radius: 3px;
  padding: 8px;
  font-size: 11px;
  overflow: auto;
  max-height: 220px;
}
.tool-call__error {
  color: var(--cinnabar);
  font-size: 12px;
}
</style>

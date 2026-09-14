<script setup lang="ts">
import type { PlanPreview } from '#shared/types'

const { chat } = useWorkspace()

interface LoosePart {
  type: string
  text?: string
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
}

const LABELS: Record<string, string> = {
  get_plan: '读取行程',
  create_plan: '创建行程',
  patch_plan_json: '修改行程',
  update_plan_json: '重写行程',
  save_plan: '保存行程',
  get_panorama: '获取街景',
  search_poi: '检索地点',
}

interface Step {
  kind: 'tool' | 'event'
  label: string
  detail: string
  status: 'ok' | 'error' | 'pending' | 'info'
  version?: number
}

function summarize(name: string, input: unknown, output?: { message?: string }): string {
  const value = input as Record<string, unknown> | undefined
  if (name === 'patch_plan_json') {
    const patch = (value?.patch as Record<string, unknown>) ?? {}
    return `字段：${Object.keys(patch).join('、') || '—'}`
  }
  if (name === 'search_poi') return `「${String(value?.query ?? '')}」@ ${String(value?.region ?? '')}`
  if (name === 'get_panorama') return `${String(value?.lng ?? '')},${String(value?.lat ?? '')}`
  if (output?.message) return output.message
  return ''
}

const steps = computed<Step[]>(() => {
  const list: Step[] = []
  for (const message of chat.value?.messages ?? []) {
    for (const part of message.parts as unknown as LoosePart[]) {
      if (part.type === 'text' && part.text && message.role === 'system') {
        list.push({ kind: 'event', label: part.text, detail: '', status: 'info' })
        continue
      }
      if (!part.type.startsWith('tool-')) continue
      const name = part.type.slice('tool-'.length)
      const output = part.output as
        | { preview?: PlanPreview; version?: number; ok?: boolean; message?: string }
        | undefined
      const status: Step['status'] =
        part.state === 'output-error'
          ? 'error'
          : part.state === 'output-available'
            ? output?.ok === false
              ? 'error'
              : 'ok'
            : 'pending'
      list.push({
        kind: 'tool',
        label: LABELS[name] ?? name,
        detail: summarize(name, part.input, output),
        status,
        version: output?.preview?.version ?? output?.version,
      })
    }
  }
  return list
})
</script>

<template>
  <div class="trajectory">
    <div v-if="!steps.length" class="trajectory__empty">
      暂无轨迹。对话中的工具调用与系统事件会记录在这里。
    </div>
    <ol v-else class="trajectory__list">
      <li
        v-for="(step, index) in steps"
        :key="index"
        class="trajectory__item"
        :class="`trajectory__item--${step.status}`"
      >
        <span class="trajectory__dot" />
        <div class="trajectory__content">
          <span class="trajectory__label">{{ step.label }}</span>
          <span v-if="step.version" class="trajectory__version">v{{ step.version }}</span>
          <p v-if="step.detail" class="trajectory__detail">{{ step.detail }}</p>
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.trajectory {
  padding: 18px 22px;
  overflow-y: auto;
}
.trajectory__empty {
  margin: 14vh auto 0;
  max-width: 360px;
  text-align: center;
  font-size: 13px;
  color: var(--ink-faint);
  line-height: 1.8;
}
.trajectory__list {
  list-style: none;
  margin: 0;
  padding: 0 0 0 6px;
  display: grid;
  gap: 2px;
}
.trajectory__item {
  position: relative;
  display: flex;
  gap: 12px;
  padding: 8px 0 8px 4px;
}
.trajectory__item::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 26px;
  bottom: -4px;
  width: 1px;
  background: var(--line-soft);
}
.trajectory__item:last-child::before {
  display: none;
}
.trajectory__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-top: 5px;
  flex-shrink: 0;
  background: var(--bamboo);
}
.trajectory__item--error .trajectory__dot {
  background: var(--cinnabar);
}
.trajectory__item--pending .trajectory__dot {
  background: var(--gold);
}
.trajectory__item--info .trajectory__dot {
  background: var(--ink-faint);
}
.trajectory__content {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.trajectory__label {
  font-size: 13px;
  color: var(--ink);
  font-family: var(--font-serif);
}
.trajectory__item--info .trajectory__label {
  font-family: inherit;
  font-size: 12px;
  color: var(--ink-faint);
}
.trajectory__version {
  font-size: 11px;
  color: var(--gold-deep);
  font-family: var(--font-serif);
}
.trajectory__detail {
  width: 100%;
  margin: 0;
  font-size: 12px;
  color: var(--ink-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

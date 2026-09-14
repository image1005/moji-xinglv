<script setup lang="ts">
import type { PlanPreview } from '#shared/types'
import type { WorkbenchMessage } from '~/composables/useWorkspace'

const props = defineProps<{ message: WorkbenchMessage }>()

interface LoosePart {
  type: string
  text?: string
  data?: PlanPreview
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
}

const parts = computed(() => props.message.parts as unknown as LoosePart[])
const textParts = computed(() => parts.value.filter((p) => p.type === 'text' && p.text))
const previewParts = computed(() => parts.value.filter((p) => p.type === 'data-preview' && p.data))
const toolParts = computed(() => parts.value.filter((p) => p.type.startsWith('tool-')))
const isUser = computed(() => props.message.role === 'user')
const isSystem = computed(() => props.message.role === 'system')

const EDIT_TOOLS = new Set(['patch_plan_json', 'update_plan_json', 'create_plan', 'save_plan'])

function toolName(part: LoosePart): string {
  return part.type.replace(/^tool-/, '')
}

function toolPreview(part: LoosePart): PlanPreview | null {
  if (!EDIT_TOOLS.has(toolName(part))) return null
  const output = part.output as { preview?: PlanPreview } | undefined
  return output?.preview ?? null
}

const streamingEmpty = computed(
  () => props.message.role === 'assistant' && !textParts.value.length && !previewParts.value.length && !toolParts.value.length,
)
</script>

<template>
  <div v-if="isSystem" class="chat-system">
    <span class="chat-system__seal">记</span>
    <div class="chat-system__body">
      <p v-for="(part, index) in textParts" :key="index" class="chat-system__text">{{ part.text }}</p>
      <PreviewCard v-for="(part, index) in previewParts" :key="`p-${index}`" :preview="part.data!" />
    </div>
  </div>
  <div v-else class="chat-message" :class="isUser ? 'chat-message--user' : 'chat-message--assistant'">
    <div class="chat-message__bubble">
      <template v-for="(part, index) in parts" :key="index">
        <div v-if="part.type === 'text' && part.text" class="chat-message__text">
          <MDC v-if="!isUser" :value="part.text" />
          <span v-else>{{ part.text }}</span>
        </div>
        <div v-else-if="part.type === 'data-preview' && part.data" class="chat-message__preview">
          <PreviewCard :preview="part.data" />
        </div>
        <template v-else-if="part.type.startsWith('tool-')">
          <div v-if="toolPreview(part)" class="chat-message__preview">
            <PreviewCard :preview="toolPreview(part)!" />
          </div>
          <ToolCallCard
            :name="toolName(part)"
            :state="part.state"
            :input="part.input"
            :output="part.output"
            :error-text="part.errorText"
          />
        </template>
      </template>
      <div v-if="streamingEmpty" class="chat-message__thinking">运笔中…</div>
    </div>
  </div>
</template>

<style scoped>
.chat-message {
  display: flex;
  margin-bottom: 14px;
}
.chat-message--user {
  justify-content: flex-end;
}
.chat-message__bubble {
  max-width: 78%;
}
.chat-message--user .chat-message__bubble {
  background: var(--ink);
  color: var(--paper);
  border-radius: 6px 2px 6px 6px;
  padding: 8px 14px;
}
.chat-message--assistant .chat-message__bubble {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 2px 6px 6px 6px;
  padding: 10px 14px;
}
.chat-message__text {
  font-size: 14px;
  line-height: 1.75;
}
.chat-message--user .chat-message__text {
  white-space: pre-wrap;
}
.chat-message__thinking {
  color: var(--ink-faint);
  font-size: 13px;
  letter-spacing: 0.2em;
}
.chat-system {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin: 14px 0;
}
.chat-system__seal {
  width: 22px;
  height: 22px;
  border-radius: 3px;
  background: var(--cinnabar);
  color: var(--paper);
  font-family: var(--font-serif);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.chat-system__text {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--ink-faint);
  text-align: center;
}
.chat-system__body {
  max-width: 560px;
}
</style>

<script setup lang="ts">
import type { PlanPreview } from '#shared/types'
import type { WorkbenchMessage } from '~/features/workspace/messages'
import { SearchSourceSchema } from '#shared/schemas/model-config'

const props = defineProps<{ message: WorkbenchMessage; streaming?: boolean }>()

const { user } = useCurrentUser()
const userInitial = computed(() => {
  const name = user.value?.name || user.value?.email?.split('@')[0]
  return name ? name.slice(0, 1) : '旅'
})

interface LoosePart {
  type: string
  text?: string
  data?: PlanPreview
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
  url?: string
  filename?: string
  mediaType?: string
  title?: string
}

const parts = computed(() => {
  const all = props.message.parts as unknown as LoosePart[]
  const keys = new Set(all.flatMap((part) => {
    const preview = toolPreview(part)
    return preview ? [`${preview.planId}:${preview.version}`] : []
  }))
  return all.filter((part) => {
    if (part.type !== 'data-preview' || !part.data) return true
    const key = `${part.data.planId}:${part.data.version}`
    if (keys.has(key)) return false
    keys.add(key)
    return true
  })
})
const textParts = computed(() => parts.value.filter((p) => p.type === 'text' && p.text))
const previewParts = computed(() => parts.value.filter((p) => p.type === 'data-preview' && p.data))
const toolParts = computed(() => parts.value.filter((p) => p.type.startsWith('tool-')))
const isUser = computed(() => props.message.role === 'user')
const isSystem = computed(() => props.message.role === 'system')
const sources = computed(() => {
  const values = parts.value.flatMap(part => {
    const output = part.output as { sources?: unknown[] } | undefined
    return Array.isArray(output?.sources) ? output.sources : []
  }).flatMap(value => { const parsed = SearchSourceSchema.safeParse(value); return parsed.success ? [parsed.data] : [] })
  return [...new Map(values.map(source => [source.url, source])).values()]
})
function attachmentUrl(url?: string) { return url && /^\/api\/attachments\/[a-f0-9-]+$/.test(url) ? url : '' }
function sourceUrl(url?: string) { return url && /^https?:\/\//.test(url) ? url : '' }

function toolName(part: LoosePart): string {
  return part.type.replace(/^tool-/, '')
}

function toolPreview(part: LoosePart): PlanPreview | null {
  if (!part.type.startsWith('tool-') || part.state !== 'output-available') return null
  const output = part.output as { preview?: PlanPreview } | undefined
  return output?.preview ?? null
}

const streamingEmpty = computed(
  () => props.streaming && props.message.role === 'assistant' && !textParts.value.length && !previewParts.value.length && !toolParts.value.length,
)
</script>

<template>
  <div v-if="isSystem" class="chat-system">
    <span class="chat-system__seal" aria-hidden="true">笺</span>
    <div class="chat-system__body">
      <p v-for="(part, index) in textParts" :key="index" class="chat-system__text">{{ part.text }}</p>
      <PreviewCard v-for="(part, index) in previewParts" :key="`p-${index}`" :preview="part.data!" />
    </div>
  </div>
  <div v-else class="chat-message" :class="isUser ? 'chat-message--user' : 'chat-message--assistant'">
    <!-- AI 助手左侧印章头像与光环 -->
    <div
      v-if="!isUser"
      class="assistant-seal-avatar"
      :class="{ generating: streaming }"
      aria-hidden="true"
    >
      <span>山</span>
    </div>

    <div class="chat-message__bubble">
      <template v-for="(part, index) in parts" :key="index">
        <div v-if="part.type === 'text' && part.text" class="chat-message__text">
          <StreamingMarkdown v-if="!isUser" :value="part.text" :streaming="streaming" />
          <span v-else>{{ part.text }}</span>
        </div>
        <div v-else-if="part.type === 'data-preview' && part.data" class="chat-message__preview">
          <PreviewCard :preview="part.data" />
        </div>
        <a v-else-if="part.type === 'file' && attachmentUrl(part.url)" class="chat-message__file" :href="attachmentUrl(part.url)" target="_blank" rel="noopener noreferrer"><img :src="attachmentUrl(part.url)" :alt="part.filename || '用户上传的旅行图片'" loading="lazy"><span>{{ part.filename || '图片附件' }}</span></a>
        <a v-else-if="part.type === 'source-url' && sourceUrl(part.url)" :href="sourceUrl(part.url)" class="chat-message__source" target="_blank" rel="noopener noreferrer">{{ part.title || part.url }}</a>
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
      <details v-if="sources.length" class="chat-message__sources"><summary>联网来源 · {{ sources.length }} 条</summary><article v-for="source in sources" :key="source.url"><a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }}</a><p>{{ source.summary || '搜索提供方未返回明文摘要，可打开来源查看。' }}</p><small>{{ source.provider }} · 获取于 {{ new Date(source.fetchedAt).toLocaleString('zh-CN') }}</small></article></details>

      <!-- 生成中空状态等待水墨微波 -->
      <div v-if="streamingEmpty" class="chat-message__thinking">
        <span class="thinking-core" />
        <span class="thinking-text">正在等待模型回复…</span>
      </div>
    </div>

    <!-- 用户消息右侧印章头像 -->
    <div
      v-if="isUser"
      class="user-seal-avatar"
      aria-hidden="true"
    >
      <span>{{ userInitial }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use "~/assets/styles/variables" as *;
.chat-message__file { display: inline-flex; flex-direction: column; gap: 6px; max-width: min(260px, 100%); margin: 4px; color: var(--text-muted); font-size: 11px; }
.chat-message__file img { width: 100%; max-height: 240px; object-fit: contain; border-radius: 6px; background: var(--bg-card-muted); }
.chat-message__sources { margin-top: 12px; border-top: 1px solid var(--border-primary); padding-top: 9px; font-size: 12px; }
.chat-message__sources summary { cursor: pointer; color: var(--bamboo); }
.chat-message__sources article { margin-top: 10px; line-height: 1.6; }
.chat-message__sources p { margin: 5px 0; }
.chat-message__sources a, .chat-message__source { color: var(--bamboo); overflow-wrap: anywhere; }
.chat-message__sources small { color: var(--text-muted); }

.chat-message {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  margin-bottom: 22px;
  animation: rise-in $dur-slow $ease-ink both;

  &--user {
    justify-content: flex-end;
  }

  &--assistant {
    justify-content: flex-start;
  }
}

/* 用户印章头像 */
.user-seal-avatar {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background-color: var(--bamboo);
  color: #ffffff;
  font-family: var(--font-serif);
  font-weight: 700;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 3px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2), var(--shadow-sm);
  transition: transform $dur-base $ease-spring;
  user-select: none;

  &:hover {
    transform: scale(1.08);
  }
}

/* 助手印章头像 */
.assistant-seal-avatar {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background-color: var(--cinnabar);
  color: #ffffff;
  font-family: var(--font-serif);
  font-weight: 700;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 3px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2), var(--shadow-sm);
  transition: transform $dur-base $ease-spring;
  user-select: none;

  &:hover {
    transform: scale(1.08);
  }

  /* 生成中外围流光光环 */
  &.generating::before {
    content: "";
    position: absolute;
    inset: -3px;
    border-radius: 11px;
    padding: 2px;
    background: conic-gradient(
      from 0deg,
      transparent 0deg,
      var(--cinnabar) 90deg,
      transparent 180deg,
      var(--gold) 270deg,
      transparent 360deg
    );
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
    animation: halo-spin 2.6s linear infinite;
    pointer-events: none;
  }
}

.chat-message__bubble {
  max-width: 80%;
}

.chat-message--user .chat-message__bubble {
  background: var(--bg-card-muted);
  color: var(--text-primary);
  border: 1px solid var(--border-secondary);
  border-radius: 16px 4px 16px 16px;
  padding: 12px 18px;
  box-shadow: var(--shadow-sm);
  font-size: 14.5px;
  line-height: 1.65;
  transition: box-shadow $dur-fast $ease-soft, border-color $dur-fast $ease-soft;

  &:hover {
    box-shadow: var(--shadow-card);
  }
}

.chat-message--assistant .chat-message__bubble {
  flex: 1;
  min-width: 0;
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 4px 16px 16px 16px;
  padding: 14px 18px;
  box-shadow: var(--shadow-card);
  transition: border-color $dur-fast $ease-soft, box-shadow $dur-fast $ease-soft;

  &:hover {
    box-shadow: var(--shadow-float);
  }
}

.chat-message__text {
  font-size: 14.5px;
  line-height: 1.8;
  color: var(--text-primary);
}

.chat-message--user .chat-message__text {
  white-space: pre-wrap;
  color: inherit;
}

.chat-message__thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--bamboo);
  font-size: 13px;
  padding: 4px 0;

  .thinking-core {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--bamboo);
    animation: breathe 1.2s ease-in-out infinite;
  }

  .thinking-text {
    letter-spacing: 0.05em;
    animation: breathe 2s ease-in-out infinite;
  }
}

.chat-system {
  display: flex;
  gap: 10px;
  justify-content: center;
  align-items: flex-start;
  margin: 18px 0;
  animation: fade-in $dur-slow $ease-soft both;
}

.chat-system__seal {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: var(--cinnabar);
  color: #ffffff;
  font-family: var(--font-serif);
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 6px var(--accent-red-subtle);
}

.chat-system__text {
  margin: 2px 0 6px;
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.6;
}

.chat-system__body {
  max-width: 580px;
}
</style>

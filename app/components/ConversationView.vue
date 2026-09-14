<script setup lang="ts">
const {
  chat,
  conversations,
  currentPlan,
  currentConversationId,
  errorMessage,
  savedAt,
  loading,
  sendMessage,
  stop,
  savePlan,
  newSession,
  createWorkspace,
  removeConversation,
  openPlanView,
} = useWorkspace()

const tab = ref<'chat' | 'trajectory'>('chat')
const input = ref('')
const scroller = ref<HTMLElement | null>(null)

const messages = computed(() => chat.value?.messages ?? [])
const streaming = computed(
  () => chat.value?.status === 'streaming' || chat.value?.status === 'submitted',
)
const conversation = computed(
  () => conversations.value.find((c) => c.id === currentConversationId.value) ?? null,
)

function scrollToBottom() {
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(
  () => [messages.value.length, chat.value?.status, tab.value, currentConversationId.value],
  () => nextTick(scrollToBottom),
)

async function submit() {
  const text = input.value.trim()
  if (!text || streaming.value) return
  input.value = ''
  await sendMessage(text)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void submit()
  }
}

async function onNewConversation() {
  await newSession()
}

async function onRemoveConversation() {
  if (!conversation.value) return
  if (!window.confirm('删除该会话及其消息记录？')) return
  await removeConversation(conversation.value.id)
}

async function startWorkspace() {
  const result = await createWorkspace()
  await openPlanView(result.planId)
}
</script>

<template>
  <section class="conv">
    <div class="conv__tabs">
      <button class="conv__tab" :class="{ 'conv__tab--active': tab === 'chat' }" @click="tab = 'chat'">
        对话
      </button>
      <button
        class="conv__tab"
        :class="{ 'conv__tab--active': tab === 'trajectory' }"
        @click="tab = 'trajectory'"
      >
        轨迹
      </button>
      <div class="conv__tabs-actions">
        <button class="btn btn--ghost btn--small" :disabled="!currentPlan" @click="onNewConversation">
          新对话
        </button>
        <button v-if="conversation" class="btn btn--ghost btn--small" @click="onRemoveConversation">
          删除会话
        </button>
      </div>
    </div>

    <div v-if="!conversation" class="conv__empty">
      <p class="conv__empty-title">执笔，替你安排山河</p>
      <p class="conv__empty-sub">新建一个工作区，或直接开始一段新对话。</p>
      <div class="conv__empty-actions">
        <button class="btn btn--seal" @click="startWorkspace">新建工作区</button>
        <button class="btn" @click="onNewConversation">开始新会话</button>
      </div>
      <p v-if="loading" class="conv__empty-sub">加载中…</p>
    </div>

    <template v-else>
      <div v-if="tab === 'chat'" ref="scroller" class="conv__messages">
        <div v-if="!messages.length" class="conv__hint">
          <p>告诉我目的地、天数与偏好，我来起草第一版行程；修改会通过工具写入右侧工作区的 JSON。</p>
        </div>
        <ChatMessage v-for="message in messages" :key="message.id" :message="message" />
        <p v-if="errorMessage" class="conv__error">{{ errorMessage }}</p>
      </div>
      <TrajectoryView v-else class="conv__trajectory" />

      <footer class="conv__footer">
        <div class="conv__input">
          <textarea
            v-model="input"
            rows="2"
            placeholder="发消息或描述你的行程需求…（Enter 发送，Shift + Enter 换行）"
            :disabled="streaming"
            @keydown="onKeydown"
          />
          <div class="conv__input-bar">
            <span v-if="savedAt" class="conv__saved">已保存 {{ formatDateTime(savedAt) }}</span>
            <button class="btn btn--ghost btn--small" @click="savePlan()">保存</button>
            <button
              v-if="streaming"
              class="conv__send conv__send--stop"
              title="停止生成"
              @click="stop()"
            >
              <AppIcon name="stop" :size="14" />
            </button>
            <button
              v-else
              class="conv__send"
              :disabled="!input.trim()"
              title="发送"
              @click="submit()"
            >
              <AppIcon name="send" :size="15" />
            </button>
          </div>
        </div>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.conv {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.conv__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 18px;
  height: 40px;
  border-bottom: 1px solid var(--line-soft);
  flex-shrink: 0;
}
.conv__tab {
  border: none;
  background: none;
  padding: 8px 10px;
  font-size: 14px;
  font-family: inherit;
  color: var(--ink-faint);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.conv__tab--active {
  color: var(--cinnabar);
  border-bottom-color: var(--cinnabar);
}
.conv__tabs-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.conv__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
}
.conv__empty-title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 22px;
  letter-spacing: 0.3em;
  color: var(--ink-soft);
}
.conv__empty-sub {
  margin: 0;
  font-size: 13px;
  color: var(--ink-faint);
}
.conv__empty-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}
.conv__messages {
  flex: 1;
  overflow-y: auto;
  padding: 18px 22px;
}
.conv__hint {
  margin: 8vh auto 24px;
  max-width: 480px;
  text-align: center;
  font-size: 13px;
  color: var(--ink-faint);
  line-height: 1.9;
}
.conv__error {
  color: var(--cinnabar);
  font-size: 13px;
}
.conv__trajectory {
  flex: 1;
}
.conv__footer {
  flex-shrink: 0;
  padding: 10px 22px 16px;
  border-top: 1px solid var(--line-soft);
}
.conv__input {
  max-width: 860px;
  margin: 0 auto;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  padding: 10px 12px 8px;
  box-shadow: 0 6px 18px rgba(43, 43, 43, 0.05);
}
.conv__input textarea {
  width: 100%;
  border: none;
  background: none;
  resize: none;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.7;
  color: var(--ink);
  min-height: 44px;
}
.conv__input textarea:focus {
  outline: none;
}
.conv__input-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.conv__saved {
  font-size: 12px;
  color: var(--ink-faint);
  margin-right: auto;
}
.conv__send {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: var(--cinnabar);
  color: var(--paper);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin-left: auto;
}
.conv__send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.conv__send--stop {
  background: var(--ink-soft);
}
@media (max-width: 960px) {
  .conv__messages,
  .conv__footer {
    padding-left: 12px;
    padding-right: 12px;
  }
}
</style>

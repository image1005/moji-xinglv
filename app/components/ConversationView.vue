<script setup lang="ts">
import { apiErrorMessage } from '~/utils/api'

const {
  chat, conversations, currentPlan, currentConversationId, errorMessage, savedAt,
  loading, sendMessage, retryMessage, stop, savePlan, newSession, createWorkspace, messagesHasMore, loadingHistory, loadOlderMessages, runs, reloadConversation, refreshRuns, offline,
} = useWorkspace()
const tab = ref<'chat' | 'roadmap'>('chat')
const drafts = reactive<Record<string, string>>({})
const draftKey = computed(() => currentConversationId.value ? `chat:${currentConversationId.value}` : `plan:${currentPlan.value?.id ?? 'new'}`)
const input = computed({ get: () => drafts[draftKey.value] ?? '', set: (value: string) => { drafts[draftKey.value] = value } })
const scroller = ref<HTMLElement | null>(null)
const textarea = ref<HTMLTextAreaElement | null>(null)
const stickToBottom = ref(true)
const sending = ref(false)
const saving = ref(false)
const composing = ref(false)
const localError = ref('')
const lastRequest = ref<{ key: string; text: string } | null>(null)
const guide = reactive({ destination: '', days: 3, budget: '', people: 2, pace: '舒缓' })
const latestRun = computed(() => runs.value[0])
const messages = computed(() => chat.value?.messages ?? [])
const streaming = computed(() => chat.value?.status === 'streaming' || chat.value?.status === 'submitted')
const busy = computed(() => loading.value || sending.value || saving.value || streaming.value || offline.value)
const conversation = computed(() => conversations.value.find((c) => c.id === currentConversationId.value) ?? null)
const visibleError = computed(() => localError.value || errorMessage.value)
const canRestore = computed(() => lastRequest.value?.key === draftKey.value && !!lastRequest.value.text)
const suggestions = [
  { icon: 'leaf', number: '壹', title: '寻一城烟火', route: '杭州 · 人文慢游', prompt: '想去杭州玩 3 天，喜欢江南园林、老街和当地小吃，节奏慢一点，请帮我规划行程。', tag: '城市漫游' },
  { icon: 'mountain', number: '贰', title: '赴一场山海', route: '大理 · 山野寻风', prompt: '帮我安排大理 5 日旅行，想看看苍山洱海、逛当地市集，留出发呆和拍照的时间。', tag: '自然疗愈' },
  { icon: 'bowl', number: '叁', title: '偷半日清闲', route: '苏州 · 周末食记', prompt: '这个周末去苏州 2 天，想逛园林、听评弹、吃苏式面和时令点心，请安排一份不赶路的行程。', tag: '周末出逃' },
] as const

function scrollToBottom() {
  if (stickToBottom.value && scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
}
function onScroll() {
  const el = scroller.value
  if (el) stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 100
}
let scrollFrame = 0
function scheduleScroll() {
  if (!import.meta.client || scrollFrame || loadingHistory.value) return
  scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; scrollToBottom() })
}
watch(() => [messages.value.length, messages.value.at(-1)?.parts.map((part) => part.type === 'text' ? part.text.length : part.type).join(':')], scheduleScroll)
onBeforeUnmount(() => { if (scrollFrame) cancelAnimationFrame(scrollFrame) })
watch([currentConversationId, tab], () => {
  localError.value = ''
  stickToBottom.value = true
  void nextTick(scrollToBottom)
})
onActivated(() => void nextTick(scrollToBottom))

function fillGuide() {
  if (!guide.destination.trim() || busy.value) return
  useSuggestion(`请为 ${guide.people} 人规划${guide.destination.trim()} ${guide.days} 天旅行，节奏${guide.pace}${guide.budget ? `，总预算 ${guide.budget} 元人民币` : ''}。请安排每日景点、住宿和餐饮，保留休息时间，并注明需要出行前核实的信息。`)
}
async function loadHistory() {
  const element = scroller.value
  const height = element?.scrollHeight ?? 0
  const top = element?.scrollTop ?? 0
  stickToBottom.value = false
  await loadOlderMessages()
  await nextTick()
  if (element) element.scrollTop = top + element.scrollHeight - height
}
function tabKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const element = event.currentTarget as HTMLElement
  tab.value = event.key === 'Home' ? 'chat' : event.key === 'End' ? 'roadmap' : tab.value === 'chat' ? 'roadmap' : 'chat'
  void nextTick(() => element.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
}
async function recoverConversation() { await reloadConversation(); await refreshRuns() }

function useSuggestion(prompt: string) {
  if (busy.value) return
  input.value = prompt
  tab.value = 'chat'
  void nextTick(() => textarea.value?.focus())
}

async function submit() {
  const text = input.value.trim()
  if (!text || busy.value || composing.value) return
  const originalKey = draftKey.value
  let requestKey = originalKey
  sending.value = true
  localError.value = ''
  errorMessage.value = ''
  stickToBottom.value = true
  try {
    if (!currentPlan.value && !await createWorkspace('未命名行笺')) {
      drafts[draftKey.value] = text
      return
    }
    if (!chat.value && !await newSession()) {
      drafts[draftKey.value] = text
      return
    }
    requestKey = draftKey.value
    drafts[requestKey] = text
    lastRequest.value = { key: requestKey, text }
    const result = await sendMessage(text)
    if (result !== null && !errorMessage.value) {
      drafts[originalKey] = ''
      drafts[requestKey] = ''
    }
  } catch (error) {
    drafts[requestKey] = text
    localError.value = apiErrorMessage(error, '消息暂未发出，内容已保留，请重试。')
  } finally {
    sending.value = false
    void nextTick(() => textarea.value?.focus())
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing || composing.value || event.keyCode === 229) return
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void submit()
  }
}

function restoreMessage() {
  if (!canRestore.value || busy.value || !lastRequest.value) return
  input.value = lastRequest.value.text
  void nextTick(() => textarea.value?.focus())
}
async function retryAsNewTurn() {
  if (!canRestore.value || busy.value || !lastRequest.value) return
  if (!window.confirm('已保存的行程改动会保留。将这段需求作为新一轮发送，请先确认不需要调整需求。')) return
  sending.value = true
  try {
    if (await retryMessage(lastRequest.value.text)) input.value = ''
  } finally { sending.value = false }
}

async function onSave() {
  if (busy.value || !currentPlan.value) return
  saving.value = true
  localError.value = ''
  try {
    if (!await savePlan()) localError.value = errorMessage.value || '保存未完成，请重试。'
  } catch (error) {
    localError.value = apiErrorMessage(error, '保存未完成，请重试。')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="conv" :class="{ 'conv--welcome': !messages.length && tab === 'chat' }">
    <div v-if="conversation" class="conv__tabs" role="tablist" aria-label="对话视图" @keydown="tabKey">
      <button id="conversation-tab" class="conv__tab" :class="{ 'conv__tab--active': tab === 'chat' }" role="tab" aria-controls="conversation-panel" :tabindex="tab === 'chat' ? 0 : -1" :aria-selected="tab === 'chat'" @click="tab = 'chat'"><AppIcon name="chat" :size="14" />旅途对话</button>
      <button id="roadmap-tab" class="conv__tab" :class="{ 'conv__tab--active': tab === 'roadmap' }" role="tab" aria-controls="roadmap-panel" :tabindex="tab === 'roadmap' ? 0 : -1" :aria-selected="tab === 'roadmap'" @click="tab = 'roadmap'"><AppIcon name="compass" :size="14" />版本路线</button>
    </div>

    <div v-if="tab === 'chat'" id="conversation-panel" ref="scroller" class="conv__scroll" role="tabpanel" :aria-labelledby="conversation ? 'conversation-tab' : undefined" @scroll="onScroll">
      <div v-if="!messages.length" class="welcome">
        <div class="welcome__intro">
          <p class="eyebrow welcome__eyebrow"><span />山海之间 · 自在行旅</p>
          <h1>心有所向，<br><span>山海皆可往。</span><i aria-hidden="true">行<br>远</i></h1>
          <p class="welcome__description">把向往写在这里，让每一程都有自己的模样。</p>
          <div class="welcome__window" aria-hidden="true"><div /><AppIcon name="mountain" :size="76" /><span>一笺一世界</span></div>
        </div>
        <form class="travel-guide panel" @submit.prevent="fillGuide">
          <strong>定下这次旅行</strong>
          <div class="travel-guide__fields">
            <label class="field">目的地<input v-model="guide.destination" required maxlength="100" placeholder="想去的城市" :disabled="busy"></label>
            <label class="field">天数<input v-model.number="guide.days" type="number" min="1" max="90" required :disabled="busy"></label>
            <label class="field">人数<input v-model.number="guide.people" type="number" min="1" max="100" required :disabled="busy"></label>
            <label class="field">总预算（元）<input v-model="guide.budget" type="number" min="0" max="100000000" placeholder="可不填" :disabled="busy"></label>
            <label class="field">节奏<select v-model="guide.pace" :disabled="busy"><option>舒缓</option><option>适中</option><option>充实</option></select></label>
          </div>
          <button class="btn btn--seal btn--small" :disabled="busy || !guide.destination.trim()">填入旅行心愿</button>
        </form>
        <div class="welcome__suggest-head"><span>从一份灵感开始</span><span class="welcome__hint">或写下你的目的地</span></div>
        <div class="welcome__suggestions">
          <button v-for="suggestion in suggestions" :key="suggestion.number" class="suggestion" :disabled="busy" @click="useSuggestion(suggestion.prompt)">
            <span class="suggestion__top"><AppIcon :name="suggestion.icon" :size="20" /><span>{{ suggestion.number }}</span></span>
            <strong>{{ suggestion.title }}</strong><span class="suggestion__route">{{ suggestion.route }}</span>
            <span class="suggestion__bottom"><span>{{ suggestion.tag }}</span><AppIcon name="arrow" :size="14" /></span>
          </button>
        </div>
      </div>
      <div v-else class="conv__messages">
        <button v-if="messagesHasMore" class="btn btn--ghost" :disabled="loadingHistory || streaming" @click="loadHistory">{{ loadingHistory ? '正在翻阅…' : '查看更早的对话' }}</button>
        <ChatMessage v-for="(message, index) in messages" :key="message.id" :message="message" :streaming="streaming && index === messages.length - 1" />
      </div>
      <p v-if="streaming" class="conv__thinking" role="status"><span />正在为你细细安排旅途…</p>
    </div>
    <LazyVersionRoadmap v-else id="roadmap-panel" role="tabpanel" aria-labelledby="roadmap-tab" class="conv__trajectory" />

    <footer class="conv__footer">
      <div v-if="latestRun && ['interrupted', 'failed', 'running', 'queued'].includes(latestRun.status) && !streaming" class="feedback" role="status">{{ ['running', 'queued'].includes(latestRun.status) ? '这段对话仍有生成任务，可刷新查看进度。' : '上次生成未完整结束，已保存的行程和预览会保留。' }}<button class="btn btn--small" @click="recoverConversation">查看已保存结果</button></div>
      <div v-if="visibleError" class="feedback conv__error" role="alert"><span>{{ visibleError }}</span><button v-if="canRestore" class="btn btn--small btn--ghost" :disabled="busy" @click="restoreMessage">重新编辑</button><button v-if="canRestore" class="btn btn--small btn--ghost" :disabled="busy" @click="retryAsNewTurn">作为新一轮重试</button></div>
      <div class="composer" :class="{ 'composer--busy': busy }">
        <label class="sr-only" for="travel-message">向旅行助手描述你的行程需求</label>
        <textarea id="travel-message" ref="textarea" v-model="input" rows="2" maxlength="20000" placeholder="想去哪里，待上几日？说说你的旅行心愿…" :disabled="busy" @keydown="onKeydown" @compositionstart="composing = true" @compositionend="composing = false" />
        <div class="composer__bar">
          <span class="composer__mode"><AppIcon name="spark" :size="13" />山海灵感</span>
          <span class="composer__divider" />
          <span class="composer__hint">{{ loading ? '正在加载行笺…' : streaming ? '正在生成，可随时停止' : 'Enter 发送 · Shift + Enter 换行' }}</span>
          <button v-if="currentPlan" class="composer__save" :disabled="busy" title="保存当前行程为新版本" @click="onSave"><AppIcon name="book" :size="13" />{{ saving ? '保存中' : '保存行笺' }}</button>
          <button v-if="streaming" class="composer__send composer__send--stop" title="停止生成" aria-label="停止生成" @click="stop()"><AppIcon name="stop" :size="16" /></button>
          <button v-else class="composer__send" :disabled="!input.trim() || busy" title="发送消息" aria-label="发送消息" @click="submit"><AppIcon name="send" :size="18" /></button>
        </div>
      </div>
      <div class="conv__footnote"><span v-if="savedAt"><AppIcon name="check" :size="11" />已保存 {{ formatDateTime(savedAt) }}</span><span v-else>一程山水，一份专属行笺</span><span>AI 生成内容仅供参考，请以实际出行信息为准</span></div>
    </footer>
  </section>
</template>

<style scoped>
.travel-guide { padding: 18px; margin: 0 0 22px; }
.travel-guide__fields { display: grid; grid-template-columns: 2fr 1fr 1fr 1.5fr 1fr; gap: 10px; margin: 12px 0; }
.travel-guide__fields input, .travel-guide__fields select { width: 100%; min-width: 0; }
@media (max-width: 640px) { .travel-guide__fields { grid-template-columns: 1fr 1fr; } .travel-guide__fields > :first-child { grid-column: 1 / -1; } }
.conv { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.conv__tabs { display: flex; align-items: center; gap: 23px; padding: 0 34px; min-height: 49px; border-bottom: 1px solid var(--line-soft); flex-shrink: 0; }
.conv__tab { display: flex; align-items: center; gap: 7px; align-self: stretch; border: none; border-bottom: 2px solid transparent; background: none; padding: 13px 0; font-size: 12px; color: var(--ink-faint); cursor: pointer; }
.conv__tab--active { color: var(--cinnabar); border-bottom-color: var(--cinnabar); }
.conv__scroll { flex: 1; min-height: 0; overflow-y: auto; }
.conv--welcome .conv__scroll { display: flex; flex-direction: column; }
.welcome { width: min(100%, 830px); margin: auto; padding: 46px 40px 38px; }
.welcome__intro { position: relative; padding-bottom: 41px; }
.welcome__eyebrow { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
.welcome__eyebrow > span { display: block; width: 23px; height: 1px; background: var(--gold); }
.welcome h1 { position: relative; display: inline-block; margin: 0; font-size: clamp(36px, 4.3vw, 56px); font-weight: 400; letter-spacing: 0.08em; line-height: 1.43; }
.welcome h1 > span { color: var(--bamboo); }
.welcome h1 i { display: inline-block; margin-left: 18px; padding: 5px 3px 5px 5px; border: 1px solid #c78f79; border-radius: 2px; color: var(--cinnabar); font-size: 11px; line-height: 1.1; font-style: normal; vertical-align: 6px; letter-spacing: 0.15em; transform: rotate(-5deg); }
.welcome__description { margin: 20px 0 0; color: var(--ink-soft); font-size: 12px; letter-spacing: 0.035em; line-height: 1.9; }
.welcome__window { position: absolute; right: 10px; top: 17px; width: 152px; height: 152px; display: flex; align-items: center; justify-content: center; border: 1px solid #e0dfd1; border-radius: 50%; color: #aebaa7; }
.welcome__window::before { content: ''; position: absolute; inset: 7px; border: 1px solid #e7e5d9; border-radius: 50%; }
.welcome__window > div { position: absolute; top: 23px; bottom: 22px; width: 96px; border-left: 1px solid #e4e3d8; border-right: 1px solid #e4e3d8; }
.welcome__window > div::after { content: ''; position: absolute; left: -10px; right: -10px; top: 22px; height: 59px; border-top: 1px solid #e4e3d8; border-bottom: 1px solid #e4e3d8; }
.welcome__window > .app-icon { z-index: 1; padding: 12px; background: var(--paper); }
.welcome__window > span { position: absolute; right: -19px; top: 34px; writing-mode: vertical-rl; color: #a4a18a; font-size: 9px; letter-spacing: 0.23em; }
.welcome__suggest-head { display: flex; justify-content: space-between; margin-bottom: 13px; font-size: 11px; color: var(--ink-soft); }
.welcome__hint { color: var(--ink-faint); font-size: 10px; }
.welcome__suggestions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.suggestion { position: relative; display: flex; flex-direction: column; padding: 19px 18px 13px; border: 1px solid var(--line); border-radius: 7px; background: var(--paper-white); text-align: left; cursor: pointer; transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s; }
.suggestion:hover:not(:disabled) { transform: translateY(-3px); border-color: var(--gold); box-shadow: var(--shadow-soft); }
.suggestion:disabled { opacity: 0.5; }
.suggestion__top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; color: var(--bamboo); }
.suggestion__top > span { color: #b9ad94; font-family: var(--font-serif); font-size: 12px; }
.suggestion:nth-child(2) .suggestion__top { color: var(--gold-deep); }
.suggestion:nth-child(3) .suggestion__top { color: var(--cinnabar); }
.suggestion > strong { margin-bottom: 7px; color: var(--ink); font-family: var(--font-serif); font-size: 18px; font-weight: 500; letter-spacing: 0.055em; }
.suggestion__route { color: var(--ink-faint); font-size: 10px; }
.suggestion__bottom { display: flex; align-items: center; justify-content: space-between; margin-top: 20px; padding-top: 11px; border-top: 1px solid var(--line-soft); color: var(--ink-faint); font-size: 9px; }
.suggestion__bottom > .app-icon { color: var(--gold-deep); }
.conv__messages { max-width: 850px; margin: 0 auto; padding: 32px 34px 16px; }
.conv__thinking { display: flex; align-items: center; gap: 8px; max-width: 782px; margin: 0 auto 20px; padding: 0 10px; color: var(--bamboo); font-size: 12px; }
.conv__thinking > span { width: 5px; height: 5px; border-radius: 50%; background: var(--bamboo); animation: breathe 1.3s ease-in-out infinite; }
.conv__trajectory { flex: 1; min-height: 0; }
.conv__footer { flex-shrink: 0; width: min(100%, 850px); margin: 0 auto; padding: 13px 34px 21px; }
.conv__error { display: flex; align-items: center; gap: 12px; justify-content: space-between; margin-bottom: 12px; }
.conv__error .btn { flex-shrink: 0; }
.composer { padding: 15px 16px 11px; border: 1px solid #d7d7c9; border-radius: 10px; background: var(--paper-white); box-shadow: 0 6px 24px rgb(47 62 38 / 4%); transition: border-color 0.18s, box-shadow 0.18s; }
.composer:focus-within { border-color: var(--bamboo); box-shadow: 0 0 0 3px rgb(82 115 98 / 5%), var(--shadow-soft); }
.composer textarea { display: block; width: 100%; min-height: 60px; max-height: 180px; border: none; background: none; resize: vertical; font-size: 13px; line-height: 1.9; color: var(--ink); }
.composer textarea:focus { outline: none; }
.composer textarea::placeholder { color: #96998c; }
.composer__bar { display: flex; align-items: center; gap: 10px; padding-top: 8px; }
.composer__mode { display: flex; align-items: center; gap: 5px; color: var(--bamboo); font-size: 10px; white-space: nowrap; }
.composer__divider { width: 1px; height: 11px; background: var(--line); }
.composer__hint { color: var(--ink-faint); font-size: 9px; }
.composer__save { display: flex; align-items: center; gap: 5px; margin-left: auto; border: none; padding: 6px 0; background: none; color: var(--ink-soft); font-size: 10px; cursor: pointer; white-space: nowrap; }
.composer__save:disabled { opacity: 0.5; }
.composer__send { width: 33px; height: 33px; flex-shrink: 0; border-radius: 5px; border: 1px solid var(--cinnabar); background: var(--cinnabar); color: var(--paper-white); display: flex; align-items: center; justify-content: center; cursor: pointer; margin-left: auto; }
.composer__save + .composer__send { margin-left: 5px; }
.composer__send:disabled { color: #b8b8aa; background: var(--paper-deep); border-color: var(--line); cursor: not-allowed; }
.composer__send--stop { color: var(--cinnabar); background: var(--cinnabar-soft); }
.conv__footnote { display: flex; justify-content: space-between; gap: 8px; padding: 12px 2px 0; color: #999b8f; font-size: 9px; line-height: 1.6; }
.conv__footnote > span { display: flex; align-items: center; gap: 4px; }
@keyframes breathe { 50% { opacity: 0.35; } }
@media (max-width: 1200px) { .welcome__window { width: 124px; height: 124px; right: 5px; top: 24px; } .welcome__window > div { width: 76px; top: 18px; bottom: 18px; } .welcome__window > div::after { top: 18px; height: 49px; } }
@media (max-width: 720px) { .welcome { padding: 32px 22px; } .welcome__window { width: 105px; height: 105px; right: 13px; top: 25px; } .welcome__window > div { width: 66px; } .welcome__window > div::after { top: 14px; height: 37px; } .welcome h1 { font-size: 40px; } .welcome__intro { padding-bottom: 32px; } .conv__tabs { padding: 0 22px; } .conv__footer { padding: 12px 20px 16px; } .conv__messages { padding: 22px; } .composer__hint { display: none; } .composer__divider { display: none; } }
@media (max-width: 520px) { .welcome__window { display: none; } .welcome h1 { font-size: 38px; } .welcome__eyebrow { margin-bottom: 20px; } .welcome__description { max-width: 275px; } .welcome__suggestions { gap: 8px; } .suggestion { padding: 14px 10px 11px; } .suggestion > strong { font-size: 14px; } .suggestion__top { margin-bottom: 15px; } .suggestion__route { font-size: 9px; line-height: 1.6; } .suggestion__bottom { margin-top: 15px; } .conv__footnote { justify-content: center; text-align: center; font-size: 8px; } .conv__footnote > span:first-child { display: none; } .composer { padding: 12px; } .conv__error { flex-wrap: wrap; } }
@media (max-height: 760px) and (min-width: 961px) { .welcome { padding-top: 28px; padding-bottom: 22px; } .welcome__intro { padding-bottom: 28px; } .welcome__eyebrow { margin-bottom: 16px; } .welcome h1 { font-size: 47px; } .welcome__description { margin-top: 13px; } }
</style>

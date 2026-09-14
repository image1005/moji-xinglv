import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport, type UIMessage } from 'ai'
import type { Plan } from '#shared/schemas/plan'
import type { MessageRecord, PlanPreview } from '#shared/types'
import {
  api,
  type ConversationItem,
  type PlanDetail,
  type PlanListItem,
  type VersionItem,
} from '~/utils/api'

/** 工作台单例状态：工作区（= 规划）/ 会话 / 消息 / 版本（左侧栏 dsh 式工作区模型） */

export type WorkbenchMessage = UIMessage<unknown, { preview: PlanPreview }>
export type MainMode = 'chat' | 'plan' | 'settings'
export type SortOrder = 'updated' | 'created'

const EXPAND_KEY = 'guofeng:expanded-workspaces'
const SORT_KEY = 'guofeng:workspace-sort'

const plans = ref<PlanListItem[]>([])
const conversations = ref<ConversationItem[]>([])
const versions = ref<VersionItem[]>([])
const currentPlan = ref<PlanDetail | null>(null)
const currentConversationId = ref<number | null>(null)
const chat = shallowRef<Chat<WorkbenchMessage> | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const savedAt = ref<Date | null>(null)
const uiLeftOpen = ref(false)
const mainMode = ref<MainMode>('chat')
const keyword = ref('')
const sortOrder = ref<SortOrder>('updated')
const expanded = ref<Record<number, boolean>>({})

// ---------- 工作区树 ----------

function persistUi() {
  if (!import.meta.client) return
  try {
    localStorage.setItem(EXPAND_KEY, JSON.stringify(expanded.value))
    localStorage.setItem(SORT_KEY, sortOrder.value)
  } catch {
    // 忽略隐私模式下的写入失败
  }
}

function loadUi() {
  if (!import.meta.client) return
  try {
    expanded.value = JSON.parse(localStorage.getItem(EXPAND_KEY) ?? '{}') as Record<number, boolean>
    const sort = localStorage.getItem(SORT_KEY)
    if (sort === 'created' || sort === 'updated') sortOrder.value = sort
  } catch {
    expanded.value = {}
  }
}

function isExpanded(planId: number) {
  return expanded.value[planId] !== false
}

function toggleExpanded(planId: number) {
  expanded.value = { ...expanded.value, [planId]: !isExpanded(planId) }
  persistUi()
}

function toggleSort() {
  sortOrder.value = sortOrder.value === 'updated' ? 'created' : 'updated'
  persistUi()
}

const conversationsByPlan = computed(() => {
  const map = new Map<number, ConversationItem[]>()
  const sorted = [...conversations.value].sort(
    (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt),
  )
  for (const conversation of sorted) {
    const list = map.get(conversation.planId) ?? []
    list.push(conversation)
    map.set(conversation.planId, list)
  }
  return map
})

const workspaces = computed(() => {
  const kw = keyword.value.trim()
  const ordered = [...plans.value].sort((a, b) =>
    sortOrder.value === 'created'
      ? +new Date(b.createdAt) - +new Date(a.createdAt)
      : +new Date(b.updatedAt) - +new Date(a.updatedAt),
  )
  return ordered
    .map((plan) => {
      const list = conversationsByPlan.value.get(plan.id) ?? []
      return { plan, conversations: kw ? list.filter((c) => c.title.includes(kw)) : list }
    })
    .filter(({ plan, conversations }) => {
      if (!kw) return true
      return plan.title.includes(kw) || plan.summary.includes(kw) || conversations.length > 0
    })
})

function createChat(conversationId: number, planId: number) {
  return new Chat<WorkbenchMessage>({
    transport: new DefaultChatTransport<WorkbenchMessage>({
      api: '/api/chat',
      body: () => ({ conversationId, planId }),
    }),
    onError: (error) => {
      errorMessage.value = error.message || 'AI 服务出错，请稍后重试'
    },
    onFinish: () => {
      void afterAssistantTurn()
    },
  })
}

interface StoredToolCall {
  id?: string
  name?: string
  input?: unknown
  output?: unknown
  error?: unknown
}

function toWorkbenchMessages(records: MessageRecord[]): WorkbenchMessage[] {
  return records.map((record) => {
    const parts: unknown[] = []
    if (record.content) parts.push({ type: 'text', text: record.content })
    if (Array.isArray(record.toolCalls)) {
      for (const call of record.toolCalls as StoredToolCall[]) {
        if (!call?.name) continue
        parts.push({
          type: `tool-${call.name}`,
          toolCallId: call.id ?? `db-tool-${record.id}-${parts.length}`,
          state: call.error ? 'output-error' : 'output-available',
          input: call.input,
          output: call.output,
          errorText: call.error,
        })
      }
    }
    if (record.preview) parts.push({ type: 'data-preview', data: record.preview })
    return {
      id: `db-${record.id}`,
      role: record.role === 'tool' ? 'assistant' : record.role,
      parts,
    } as unknown as WorkbenchMessage
  })
}

// ---------- 数据加载 ----------

async function loadPlans() {
  plans.value = await api.plans.list()
}

async function loadConversations() {
  conversations.value = await api.conversations.list()
}

async function loadPlan(id: number) {
  currentPlan.value = await api.plans.detail(id)
  versions.value = await api.plans.versions(id)
}

async function refreshCurrentPlan() {
  if (!currentPlan.value) return
  await loadPlan(currentPlan.value.id)
}

// ---------- 工作区与会话操作 ----------

async function openWorkspace(planId: number, opts: { conversationId?: number } = {}) {
  loading.value = true
  try {
    if (currentPlan.value?.id !== planId) await loadPlan(planId)
    await loadConversations()
    expanded.value = { ...expanded.value, [planId]: true }
    persistUi()
    const list = conversations.value.filter((c) => c.planId === planId)
    const preferred = opts.conversationId ?? currentConversationId.value ?? undefined
    const conversation = list.find((c) => c.id === preferred) ?? list[0] ?? null
    if (conversation) await openConversation(conversation.id)
    else {
      currentConversationId.value = null
      chat.value = null
    }
    mainMode.value = 'chat'
  } finally {
    loading.value = false
  }
}

async function openConversation(id: number) {
  const conversation = conversations.value.find((c) => c.id === id)
  if (!conversation) return
  if (currentPlan.value?.id !== conversation.planId) await loadPlan(conversation.planId)
  const { messages } = await api.conversations.detail(id)
  currentConversationId.value = id
  const instance = createChat(id, conversation.planId)
  instance.messages = toWorkbenchMessages(messages)
  chat.value = null
  chat.value = instance
  mainMode.value = 'chat'
  expanded.value = { ...expanded.value, [conversation.planId]: true }
  persistUi()
}

async function openPlanView(planId?: number) {
  const id = planId ?? currentPlan.value?.id
  if (!id) return
  if (currentPlan.value?.id !== id) await loadPlan(id)
  expanded.value = { ...expanded.value, [id]: true }
  persistUi()
  mainMode.value = 'plan'
}

function openSettings() {
  mainMode.value = 'settings'
}

async function createWorkspace(title = '未命名行程') {
  const result = await api.plans.create({ title })
  await loadPlans()
  await loadPlan(result.planId)
  await loadConversations()
  expanded.value = { ...expanded.value, [result.planId]: true }
  persistUi()
  currentConversationId.value = null
  chat.value = null
  return result
}

async function newSession() {
  let planId = currentPlan.value?.id
  if (!planId) planId = (await createWorkspace()).planId
  const conversation = await api.conversations.create(planId)
  await loadConversations()
  await openConversation(conversation.id)
  return conversation
}

async function removePlan(id: number) {
  await api.plans.remove(id)
  const wasCurrent = currentPlan.value?.id === id
  if (wasCurrent) {
    currentPlan.value = null
    versions.value = []
    chat.value = null
    currentConversationId.value = null
  }
  await Promise.all([loadPlans(), loadConversations()])
  if (wasCurrent) {
    const next = plans.value[0]
    if (next) await openWorkspace(next.id)
    else mainMode.value = 'chat'
  }
}

async function removeConversation(id: number) {
  await api.conversations.remove(id)
  await loadConversations()
  if (currentConversationId.value !== id) return
  const planId = currentPlan.value?.id
  const next = conversations.value.find((c) => c.planId === planId) ?? null
  if (next) await openConversation(next.id)
  else {
    currentConversationId.value = null
    chat.value = null
  }
}

async function updatePlanMeta(patch: { title?: string; summary?: string; contentMd?: string }) {
  if (!currentPlan.value) return
  await api.plans.updateMeta(currentPlan.value.id, patch)
  await refreshCurrentPlan()
  await loadPlans()
}

async function savePlan(planJson?: Plan) {
  if (!currentPlan.value) return null
  const result = await api.plans.save(currentPlan.value.id, {
    planJson,
    conversationId: currentConversationId.value ?? undefined,
  })
  savedAt.value = new Date()
  await refreshCurrentPlan()
  await Promise.all([loadPlans(), loadConversations()])
  if (currentConversationId.value) await reloadConversation()
  return result
}

async function rollback(version: number) {
  if (!currentPlan.value) return
  await api.plans.rollback(currentPlan.value.id, {
    version,
    conversationId: currentConversationId.value ?? undefined,
  })
  await refreshCurrentPlan()
  await Promise.all([loadPlans(), loadConversations()])
  if (currentConversationId.value) await reloadConversation()
}

async function reloadConversation() {
  if (!currentConversationId.value || !chat.value) return
  const { messages } = await api.conversations.detail(currentConversationId.value)
  chat.value.messages = toWorkbenchMessages(messages)
}

let afterTimer: ReturnType<typeof setTimeout> | null = null
function afterAssistantTurn() {
  if (afterTimer) clearTimeout(afterTimer)
  afterTimer = setTimeout(() => {
    void (async () => {
      try {
        await refreshCurrentPlan()
        await Promise.all([loadPlans(), loadConversations()])
        await reloadConversation()
      } catch (error) {
        console.error('[workspace] 刷新失败', error)
      }
    })()
  }, 500)
}

async function sendMessage(text: string) {
  if (!text.trim()) return
  errorMessage.value = ''
  if (!chat.value) {
    if (!currentPlan.value) {
      errorMessage.value = '请先新建工作区'
      return
    }
    await newSession()
  }
  if (!chat.value) return
  await chat.value.sendMessage({ text })
}

function stop() {
  chat.value?.stop()
}

/** 首次进入工作台：恢复偏好 → 加载数据 → 打开最近的工作区与会话 */
async function bootstrap() {
  loadUi()
  await loadPlans()
  await loadConversations()
  const recent = plans.value[0]
  if (recent) await openWorkspace(recent.id)
}

/** 退出登录时清空单例状态（配合页面 keepalive，避免换号后复用旧数据） */
function resetWorkspace() {
  chat.value?.stop()
  plans.value = []
  conversations.value = []
  versions.value = []
  currentPlan.value = null
  currentConversationId.value = null
  chat.value = null
  errorMessage.value = ''
  savedAt.value = null
  keyword.value = ''
  mainMode.value = 'chat'
  uiLeftOpen.value = false
}

export function useWorkspace() {
  return {
    plans,
    conversations,
    versions,
    currentPlan,
    currentConversationId,
    chat,
    loading,
    errorMessage,
    savedAt,
    uiLeftOpen,
    mainMode,
    keyword,
    sortOrder,
    workspaces,
    isExpanded,
    toggleExpanded,
    toggleSort,
    loadPlans,
    loadConversations,
    bootstrap,
    resetWorkspace,
    openWorkspace,
    openConversation,
    openPlanView,
    openSettings,
    createWorkspace,
    newSession,
    removePlan,
    removeConversation,
    updatePlanMeta,
    savePlan,
    rollback,
    reloadConversation,
    sendMessage,
    stop,
  }
}


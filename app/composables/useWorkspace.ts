import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport, type UIMessage } from 'ai'
import type { Plan } from '#shared/schemas/plan'
import type { MessageRecord, PlanPreview } from '#shared/types'
import {
  api,
  apiErrorMessage,
  type ConversationItem,
  type PlanDetail,
  type PlanListItem,
  type VersionItem,
} from '~/utils/api'

export type WorkbenchMessage = UIMessage<unknown, { preview: PlanPreview }>
export type MainMode = 'chat' | 'plan' | 'settings'
export type SortOrder = 'updated' | 'created'

const EXPAND_KEY = 'guofeng:expanded-workspaces'
const SORT_KEY = 'guofeng:workspace-sort'

interface StoredToolCall {
  id?: string
  name?: string
  input?: unknown
  output?: { preview?: PlanPreview }
  error?: unknown
}

export function toWorkbenchMessages(records: MessageRecord[]): WorkbenchMessage[] {
  return records.map((record) => {
    const parts: unknown[] = []
    if (record.content) parts.push({ type: 'text', text: record.content })
    const calls = Array.isArray(record.toolCalls) ? record.toolCalls as StoredToolCall[] : []
    for (const call of calls) {
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
    const preview = record.preview
    if (preview && !calls.some((call) => !call.error && call.output?.preview?.planId === preview.planId && call.output.preview.version === preview.version)) {
      parts.push({ type: 'data-preview', data: preview })
    }
    return {
      id: `db-${record.id}`,
      role: record.role === 'tool' ? 'assistant' : record.role,
      parts,
    } as unknown as WorkbenchMessage
  })
}

// Chat 含非序列化状态，按 Nuxt app 实例缓存，不能放模块单例或 useState。
const workspacesByApp = new WeakMap<object, ReturnType<typeof createWorkspaceState>>()

function createWorkspaceState() {
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
  let navigation = 0
  let lifetime = 0
  let plansRequest = 0
  let conversationsRequest = 0
  let planRequest = 0
  let messagesRequest = 0
  let afterTimer: ReturnType<typeof setTimeout> | null = null

  function persistUi() {
    if (!import.meta.client) return
    try {
      localStorage.setItem(EXPAND_KEY, JSON.stringify(expanded.value))
      localStorage.setItem(SORT_KEY, sortOrder.value)
    } catch {
      // 隐私模式下偏好仅保存在内存。
    }
  }

  function loadUi() {
    if (!import.meta.client) return
    try {
      const value: unknown = JSON.parse(localStorage.getItem(EXPAND_KEY) ?? '{}')
      expanded.value = value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).filter(([key, item]) => /^\d+$/.test(key) && typeof item === 'boolean'))
        : {}
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
    const sorted = [...conversations.value].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    for (const conversation of sorted) {
      const list = map.get(conversation.planId) ?? []
      list.push(conversation)
      map.set(conversation.planId, list)
    }
    return map
  })

  const workspaces = computed(() => {
    const kw = keyword.value.trim().toLocaleLowerCase()
    const matches = (value: string) => value.toLocaleLowerCase().includes(kw)
    return [...plans.value]
      .sort((a, b) => sortOrder.value === 'created'
        ? +new Date(b.createdAt) - +new Date(a.createdAt)
        : +new Date(b.updatedAt) - +new Date(a.updatedAt))
      .map((plan) => {
        const list = conversationsByPlan.value.get(plan.id) ?? []
        return { plan, conversations: kw && !matches(plan.title) && !matches(plan.summary) ? list.filter((c) => matches(c.title)) : list }
      })
      .filter(({ plan, conversations: list }) => !kw || matches(plan.title) || matches(plan.summary) || list.length > 0)
  })

  function clearAfterTimer() {
    if (afterTimer) clearTimeout(afterTimer)
    afterTimer = null
  }

  function stop() {
    const instance = chat.value
    if (!instance) return
    void instance.stop().catch((error: unknown) => {
      if (chat.value === instance) errorMessage.value = apiErrorMessage(error)
    })
  }

  function beginNavigation(clearChat = true) {
    navigation++
    planRequest++
    messagesRequest++
    clearAfterTimer()
    stop()
    if (clearChat) {
      chat.value = null
      currentConversationId.value = null
    }
    savedAt.value = null
    errorMessage.value = ''
    loading.value = false
    return navigation
  }

  function clearOtherPlan(id: number) {
    if (currentPlan.value?.id !== id) {
      currentPlan.value = null
      versions.value = []
    }
  }

  // 公开事件处理函数不向 Vue 泄漏未捕获拒绝；旧导航错误也不得覆盖新界面。
  function action<Args extends unknown[], Result>(fn: (...args: Args) => Promise<Result>) {
    return async (...args: Args): Promise<Result | null> => {
      const epoch = lifetime
      let token = navigation
      try {
        const pending = fn(...args)
        token = navigation
        return await pending
      } catch (error) {
        if (epoch === lifetime && token === navigation) errorMessage.value = apiErrorMessage(error)
        return null
      }
    }
  }

  async function loadPlans() {
    const request = ++plansRequest
    const epoch = lifetime
    const result = await api.plans.list()
    if (epoch === lifetime && request === plansRequest) plans.value = result
  }

  async function loadConversations() {
    const request = ++conversationsRequest
    const epoch = lifetime
    const result = await api.conversations.list()
    if (epoch === lifetime && request === conversationsRequest) conversations.value = result
  }

  async function loadPlan(id: number, token = navigation) {
    const request = ++planRequest
    const [plan, history] = await Promise.all([api.plans.detail(id), api.plans.versions(id)])
    if (token !== navigation || request !== planRequest) return false
    currentPlan.value = plan
    versions.value = history
    return true
  }

  function createChat(conversationId: number, planId: number) {
    const epoch = lifetime
    const isCurrent = () => epoch === lifetime && chat.value === instance && currentPlan.value?.id === planId && currentConversationId.value === conversationId
    const instance = new Chat<WorkbenchMessage>({
      transport: new DefaultChatTransport<WorkbenchMessage>({
        api: '/api/chat',
        body: () => ({ conversationId, planId }),
      }),
      onError: (error) => {
        if (isCurrent()) errorMessage.value = apiErrorMessage(error, 'AI 服务出错，请稍后重试')
      },
      onFinish: ({ isAbort }) => {
        if (!isAbort && isCurrent()) afterAssistantTurn(planId, conversationId, instance)
      },
    })
    return instance
  }

  async function selectConversation(id: number, planId: number, token: number) {
    const { conversation, messages } = await api.conversations.detail(id)
    if (token !== navigation) return
    if (conversation.planId !== planId) throw new Error('会话不属于当前工作区，请刷新后重试')
    const instance = createChat(id, planId)
    instance.messages = toWorkbenchMessages(messages)
    currentConversationId.value = id
    chat.value = instance
  }

  async function openWorkspace(planId: number, opts: { conversationId?: number } = {}) {
    const preferred = opts.conversationId ?? currentConversationId.value
    const token = beginNavigation()
    clearOtherPlan(planId)
    mainMode.value = 'chat'
    loading.value = true
    try {
      await Promise.all([loadPlan(planId, token), loadConversations()])
      if (token !== navigation) return
      expanded.value = { ...expanded.value, [planId]: true }
      persistUi()
      const list = conversationsByPlan.value.get(planId) ?? []
      const conversation = list.find((c) => c.id === preferred) ?? list[0]
      if (conversation) await selectConversation(conversation.id, planId, token)
    } finally {
      if (token === navigation) loading.value = false
    }
  }

  async function openConversation(id: number) {
    const conversation = conversations.value.find((c) => c.id === id)
    if (!conversation) return
    const token = beginNavigation()
    clearOtherPlan(conversation.planId)
    mainMode.value = 'chat'
    loading.value = true
    try {
      if (!currentPlan.value) await loadPlan(conversation.planId, token)
      if (token !== navigation) return
      await selectConversation(id, conversation.planId, token)
      if (token !== navigation) return
      expanded.value = { ...expanded.value, [conversation.planId]: true }
      persistUi()
    } finally {
      if (token === navigation) loading.value = false
    }
  }

  async function openPlanView(planId?: number) {
    const id = planId ?? currentPlan.value?.id
    if (!id) return
    const token = beginNavigation(currentPlan.value?.id !== id)
    clearOtherPlan(id)
    mainMode.value = 'plan'
    expanded.value = { ...expanded.value, [id]: true }
    persistUi()
    loading.value = true
    try {
      await loadPlan(id, token)
    } finally {
      if (token === navigation) loading.value = false
    }
  }

  function openSettings() {
    beginNavigation(false)
    mainMode.value = 'settings'
  }

  async function createWorkspace(title = '未命名行程', planJson?: Plan) {
    const token = beginNavigation()
    loading.value = true
    try {
      const result = await api.plans.create({ title, planJson })
      if (token !== navigation) return null
      clearOtherPlan(result.planId)
      await Promise.all([loadPlans(), loadPlan(result.planId, token), loadConversations()])
      if (token !== navigation) return null
      expanded.value = { ...expanded.value, [result.planId]: true }
      persistUi()
      return result
    } finally {
      if (token === navigation) loading.value = false
    }
  }

  async function newSession() {
    let token = beginNavigation()
    let planId = currentPlan.value?.id
    if (!planId) {
      const result = await createWorkspace()
      if (!result) return null
      planId = result.planId
      token = navigation
    }
    mainMode.value = 'chat'
    loading.value = true
    try {
      const conversation = await api.conversations.create(planId)
      if (token !== navigation) return null
      await loadConversations()
      if (token !== navigation) return null
      await selectConversation(conversation.id, planId, token)
      return token === navigation ? conversation : null
    } finally {
      if (token === navigation) loading.value = false
    }
  }

  async function removePlan(id: number) {
    const epoch = lifetime
    const token = navigation
    await api.plans.remove(id)
    if (epoch !== lifetime) return
    const wasCurrent = token === navigation && currentPlan.value?.id === id
    let nextToken = token
    if (wasCurrent) {
      nextToken = beginNavigation()
      currentPlan.value = null
      versions.value = []
    }
    await Promise.all([loadPlans(), loadConversations()])
    if (wasCurrent && nextToken === navigation) {
      const next = plans.value[0]
      if (next) await action(openWorkspace)(next.id)
      else mainMode.value = 'chat'
    }
  }

  async function removeConversation(id: number) {
    const epoch = lifetime
    const token = navigation
    await api.conversations.remove(id)
    if (epoch !== lifetime) return
    await loadConversations()
    if (token !== navigation || currentConversationId.value !== id) return
    const next = conversations.value.find((c) => c.planId === currentPlan.value?.id)
    if (next && mainMode.value === 'chat') await action(openConversation)(next.id)
    else beginNavigation()
  }

  async function updatePlanMeta(patch: {
    title?: string
    summary?: string
    cover?: string
    tags?: string[]
    tips?: string[]
    budget?: Plan['budget']
    contentMd?: string
    expectedVersion?: number
  }, expectedVersion?: number) {
    const plan = currentPlan.value
    if (!plan) return
    const token = navigation
    await api.plans.updateMeta(plan.id, { ...patch, expectedVersion: expectedVersion ?? patch.expectedVersion ?? plan.version })
    if (token !== navigation) return
    await Promise.all([loadPlan(plan.id, token), loadPlans()])
  }

  function matchingConversation(planId: number) {
    const id = currentConversationId.value
    return conversations.value.some((c) => c.id === id && c.planId === planId) ? id ?? undefined : undefined
  }

  async function refreshAfterMutation(planId: number, conversationId: number | undefined, token: number) {
    if (token !== navigation || currentPlan.value?.id !== planId) return
    await Promise.all([loadPlan(planId, token), loadPlans(), loadConversations()])
    if (token === navigation && conversationId === currentConversationId.value) await reloadConversation()
  }

  async function savePlan(planJson?: Plan, expectedVersion?: number) {
    const plan = currentPlan.value
    if (!plan) return null
    const token = navigation
    const conversationId = matchingConversation(plan.id)
    errorMessage.value = ''
    const result = await api.plans.save(plan.id, {
      planJson,
      expectedVersion: expectedVersion ?? plan.version,
      conversationId,
    })
    if (token !== navigation) return null
    savedAt.value = new Date()
    await refreshAfterMutation(plan.id, conversationId, token)
    return token === navigation ? result : null
  }

  async function switchVersion(version: number, expectedVersion?: number) {
    const plan = currentPlan.value
    if (!plan) return
    const token = navigation
    const conversationId = matchingConversation(plan.id)
    errorMessage.value = ''
    await api.plans.switchVersion(plan.id, { version, expectedVersion: expectedVersion ?? plan.version, conversationId })
    await refreshAfterMutation(plan.id, conversationId, token)
  }

  async function reloadConversation() {
    const conversationId = currentConversationId.value
    const planId = currentPlan.value?.id
    const instance = chat.value
    if (!conversationId || !instance || instance.status === 'streaming' || instance.status === 'submitted') return
    const token = navigation
    const request = ++messagesRequest
    const { conversation, messages } = await api.conversations.detail(conversationId)
    if (token !== navigation || request !== messagesRequest || chat.value !== instance || currentConversationId.value !== conversationId) return
    if (conversation.planId !== planId) throw new Error('会话与工作区不匹配，请重新打开会话')
    instance.messages = toWorkbenchMessages(messages)
  }

  function afterAssistantTurn(planId: number, conversationId: number, instance: Chat<WorkbenchMessage>) {
    clearAfterTimer()
    const token = navigation
    const isCurrent = () => token === navigation && currentPlan.value?.id === planId && currentConversationId.value === conversationId && chat.value === instance
    afterTimer = setTimeout(() => {
      afterTimer = null
      if (!isCurrent()) return
      void refreshAfterMutation(planId, conversationId, token).catch((error: unknown) => {
        if (isCurrent()) errorMessage.value = apiErrorMessage(error, '回复已完成，但刷新失败，请重试')
      })
    }, 500)
  }

  async function sendMessage(text: string) {
    if (!text.trim() || loading.value) return
    errorMessage.value = ''
    if (!chat.value) {
      if (!currentPlan.value) {
        errorMessage.value = '请先新建工作区'
        return
      }
      if (!await newSession()) return
    }
    const instance = chat.value
    if (!instance || instance.status === 'streaming' || instance.status === 'submitted') return
    clearAfterTimer()
    messagesRequest++
    await instance.sendMessage({ text })
    if (chat.value !== instance) return null
    return errorMessage.value ? null : true
  }

  async function bootstrap() {
    const token = navigation
    loadUi()
    await Promise.all([loadPlans(), loadConversations()])
    if (token !== navigation) return
    const recent = plans.value[0]
    if (recent) await action(openWorkspace)(recent.id)
  }

  function resetWorkspace() {
    lifetime++
    beginNavigation()
    plansRequest++
    conversationsRequest++
    plans.value = []
    conversations.value = []
    versions.value = []
    currentPlan.value = null
    errorMessage.value = ''
    keyword.value = ''
    mainMode.value = 'chat'
    uiLeftOpen.value = false
    expanded.value = {}
    sortOrder.value = 'updated'
    if (import.meta.client) {
      try {
        localStorage.removeItem(EXPAND_KEY)
        localStorage.removeItem(SORT_KEY)
      } catch {
        // 退出登录不能依赖浏览器存储是否可用。
      }
    }
  }

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
    loadPlans: action(loadPlans),
    loadConversations: action(loadConversations),
    bootstrap: async () => { await action(bootstrap)() },
    resetWorkspace,
    openWorkspace: action(openWorkspace),
    openConversation: action(openConversation),
    openPlanView: action(openPlanView),
    openSettings,
    createWorkspace: action(createWorkspace),
    newSession: action(newSession),
    removePlan: action(removePlan),
    removeConversation: action(removeConversation),
    updatePlanMeta: action(updatePlanMeta),
    savePlan: action(savePlan),
    switchVersion: action(switchVersion),
    reloadConversation: action(reloadConversation),
    sendMessage: action(sendMessage),
    stop,
  }
}

export function useWorkspace() {
  const app = useNuxtApp()
  let workspace = workspacesByApp.get(app)
  if (!workspace) {
    workspace = createWorkspaceState()
    workspacesByApp.set(app, workspace)
  }
  return workspace
}

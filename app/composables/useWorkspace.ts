import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport, type UIMessage } from 'ai'
import type { Plan } from '#shared/schemas/plan'
import type { MessageRecord, PlanPreview } from '#shared/types'
import { idbGet, idbSet } from '~/utils/idb'
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
  const offline = ref(false)
  const plansHasMore = ref(false)
  const loadingPlans = ref(false)
  const conversationsHasMore = ref<Record<number, boolean>>({})
  const versionsHasMore = ref(false)
  const messagesHasMore = ref(false)
  const loadingHistory = ref(false)
  const loadingVersions = ref(false)
  const runs = ref<Awaited<ReturnType<typeof api.chatRuns>>>([])
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
  let plansCursor: string | null = null
  let versionsCursor: string | null = null
  let messagesCursor: string | null = null
  let versionsRevision = -1
  let versionsRequest = 0
  let requestId = ''
  let pendingSubmission: { conversationId: number | null; text: string; requestId: string } | null = null
  const conversationCursors = new Map<number, string | null>()
  const conversationRequests = new Map<number, number>()
  const loadedConversations = new Set<number>()
  const loadedConversationIds = ref<number[]>([])
  const conversationQueries = new Map<number, string>()
  const loadingConversations = new Set<number>()
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let appliedKeyword = ''
  let appliedPlanQuery = ''
  let resetting = false

  const planQuery = () => JSON.stringify([keyword.value.trim().slice(0, 100), sortOrder.value])
  function invalidatePlanPages() {
    plansRequest++
    plansCursor = null
    plansHasMore.value = false
    loadingPlans.value = false
    appliedPlanQuery = ''
  }

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
    return expanded.value[planId] === true
  }

  function toggleExpanded(planId: number) {
    expanded.value = { ...expanded.value, [planId]: !isExpanded(planId) }
    persistUi()
    if (isExpanded(planId) && !loadedConversations.has(planId)) void action(loadConversations)(planId)
  }

  function toggleSort() {
    sortOrder.value = sortOrder.value === 'updated' ? 'created' : 'updated'
    invalidatePlanPages()
    persistUi()
    void action(loadPlans)()
  }
  watch(keyword, () => {
    clearTimeout(searchTimer)
    invalidatePlanPages()
    conversationsRequest++
    conversationCursors.clear()
    conversationQueries.clear()
    loadingConversations.clear()
    loadedConversations.clear()
    loadedConversationIds.value = []
    conversationsHasMore.value = {}
    if (resetting) return
    searchTimer = setTimeout(() => { void action(loadPlans)() }, 250)
  }, { flush: 'sync' })

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
      .filter(({ plan, conversations: list }) => kw === appliedKeyword || !kw || matches(plan.title) || matches(plan.summary) || list.length > 0)
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
    if (clearChat) {
      stop()
      chat.value = null
      currentConversationId.value = null
      messagesCursor = null
      messagesHasMore.value = false
      runs.value = []
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
      versionsCursor = null
      versionsHasMore.value = false
      versionsRevision = -1
      versionsRequest++
      loadingVersions.value = false
      offline.value = false
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

  function mergeById<T extends { id: number }>(old: T[], fresh: T[]): T[] {
    return [...new Map([...old, ...fresh].map((item) => [item.id, item])).values()]
  }

  async function loadPlans(more = false) {
    const scope = planQuery()
    if (more && (loadingPlans.value || !plansHasMore.value || !plansCursor || appliedPlanQuery !== scope)) return
    const request = ++plansRequest
    const epoch = lifetime
    const query = keyword.value.trim().slice(0, 100)
    loadingPlans.value = true
    if (!more) { plansCursor = null; plansHasMore.value = false }
    try {
      const result = await api.plans.listPage(more ? plansCursor ?? undefined : undefined, query || undefined, sortOrder.value)
      if (epoch === lifetime && request === plansRequest && scope === planQuery()) {
        appliedKeyword = query.toLocaleLowerCase()
        appliedPlanQuery = scope
        plans.value = more ? mergeById(plans.value, result.items) : result.items
        plansCursor = result.nextCursor
        plansHasMore.value = result.hasMore
        for (const item of result.items) {
          if (isExpanded(item.id) && !loadedConversations.has(item.id)) void action(loadConversations)(item.id)
        }
      }
    } finally {
      if (epoch === lifetime && request === plansRequest) loadingPlans.value = false
    }
  }

  async function loadConversations(planId?: number, more = false) {
    const scope = planId ?? 0
    const plan = plans.value.find((item) => item.id === planId)
    const keywordText = keyword.value.trim().slice(0, 100).toLocaleLowerCase()
    const query = plan && [plan.title, plan.summary].some((value) => value?.toLocaleLowerCase().includes(keywordText)) ? '' : keywordText
    if (more && (loadingConversations.has(scope) || !conversationsHasMore.value[scope] || !conversationCursors.get(scope) || conversationQueries.get(scope) !== query)) return
    const request = (conversationRequests.get(scope) ?? 0) + 1
    conversationRequests.set(scope, request)
    const generation = conversationsRequest
    const epoch = lifetime
    loadingConversations.add(scope)
    try {
      const result = await api.conversations.listPage(planId, more ? conversationCursors.get(scope) ?? undefined : undefined, query || undefined)
      if (epoch === lifetime && generation === conversationsRequest && conversationRequests.get(scope) === request) {
        const old = more ? conversations.value : conversations.value.filter((item) => planId !== undefined && item.planId !== planId)
        conversations.value = mergeById(old, result.items)
        conversationCursors.set(scope, result.nextCursor)
        conversationQueries.set(scope, query)
        conversationsHasMore.value = { ...conversationsHasMore.value, [scope]: result.hasMore }
        loadedConversations.add(scope)
        loadedConversationIds.value = [...loadedConversations]
      }
    } finally {
      if (epoch === lifetime && generation === conversationsRequest && conversationRequests.get(scope) === request) loadingConversations.delete(scope)
    }
  }

  async function loadPlan(id: number, token = navigation) {
    const request = ++planRequest
    const epoch = lifetime
    const valid = () => epoch === lifetime && token === navigation && request === planRequest
    const cached = await idbGet<PlanDetail>(`plan:${id}`).catch(() => null)
    if (valid() && !currentPlan.value && cached?.id === id && Number.isInteger(cached.revision)) currentPlan.value = cached
    try {
      const plan = await api.plans.detail(id)
      if (!valid()) return false
      currentPlan.value = plan
      offline.value = false
      plans.value = mergeById(plans.value, [{ ...plan, plan: undefined } as PlanListItem])
      void idbSet(`plan:${id}`, plan, 7 * 86400).catch(() => {})
      return true
    } catch (error) {
      if (!valid()) return false
      // 身份/权限/不存在等 HTTP 错误不可退回缓存，避免展示已撤销内容。
      const status = (error as { status?: number; statusCode?: number }).statusCode ?? (error as { status?: number }).status
      if (!status && cached?.id === id && Number.isInteger(cached.revision)) {
        currentPlan.value = cached
        offline.value = true
        return true
      }
      if (status && currentPlan.value?.id === id) currentPlan.value = null
      if (cached && [401, 403, 404].includes(status ?? 0)) void idbSet(`plan:${id}`, cached, 0).catch(() => {})
      throw error
    }
  }

  async function loadVersions(more = false) {
    const plan = currentPlan.value
    if (!plan || offline.value || loadingVersions.value || (!more && versionsRevision === plan.revision)) return false
    const token = navigation
    const request = ++versionsRequest
    loadingVersions.value = true
    try {
      const result = await api.plans.versionsPage(plan.id, more ? versionsCursor ?? undefined : undefined)
      if (token !== navigation || request !== versionsRequest || currentPlan.value?.id !== plan.id) return false
      versions.value = mergeById(more || versions.value.length ? versions.value : [], result.items).sort((a, b) => b.version - a.version)
      versionsCursor = result.nextCursor
      versionsHasMore.value = result.hasMore
      versionsRevision = plan.revision
      return true
    } finally {
      if (request === versionsRequest) loadingVersions.value = false
    }
  }

  function createChat(conversationId: number, planId: number) {
    const epoch = lifetime
    const isCurrent = () => epoch === lifetime && chat.value === instance && currentPlan.value?.id === planId && currentConversationId.value === conversationId
    const instance = new Chat<WorkbenchMessage>({
      transport: new DefaultChatTransport<WorkbenchMessage>({
        api: '/api/chat',
        body: () => ({ conversationId, planId, requestId }),
        prepareSendMessagesRequest: ({ messages, body }) => ({ body: { ...body, messages: messages.slice(-1) } }),
      }),
      onError: (error) => {
        if (isCurrent()) {
          errorMessage.value = apiErrorMessage(error, 'AI 服务出错，请稍后重试')
          afterAssistantTurn(planId, conversationId, instance)
        }
      },
      onFinish: () => {
        if (isCurrent()) afterAssistantTurn(planId, conversationId, instance)
      },
    })
    return instance
  }

  async function selectConversation(id: number, planId: number, token: number) {
    const { conversation, messages, messagePage } = await api.conversations.messagesPage(id)
    if (token !== navigation) return
    if (conversation.planId !== planId) throw new Error('会话不属于当前工作区，请刷新后重试')
    const instance = createChat(id, planId)
    instance.messages = toWorkbenchMessages(messages)
    currentConversationId.value = id
    chat.value = instance
    messagesCursor = messagePage.nextCursor
    messagesHasMore.value = messagePage.hasMore
    loadingHistory.value = false
    void refreshRuns(id)
  }

  async function openWorkspace(planId: number, opts: { conversationId?: number } = {}) {
    const preferred = opts.conversationId ?? currentConversationId.value
    if (currentPlan.value?.id === planId && preferred === currentConversationId.value && chat.value) { mainMode.value = 'chat'; return }
    const token = beginNavigation()
    clearOtherPlan(planId)
    mainMode.value = 'chat'
    loading.value = true
    try {
      await Promise.all([loadPlan(planId, token), loadConversations(planId)])
      if (token !== navigation) return
      expanded.value = { ...expanded.value, [planId]: true }
      persistUi()
      const list = conversationsByPlan.value.get(planId) ?? []
      const conversation = list.find((c) => c.id === preferred) ?? list[0]
      if (opts.conversationId) await selectConversation(opts.conversationId, planId, token)
      else if (conversation) await selectConversation(conversation.id, planId, token)
    } finally {
      if (token === navigation) loading.value = false
    }
  }

  async function openConversation(id: number) {
    if (currentConversationId.value === id && chat.value) { mainMode.value = 'chat'; return }
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
    if (currentPlan.value?.id === id) { mainMode.value = 'plan'; return }
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
    mainMode.value = 'settings'
  }

  async function createWorkspace(title = '未命名行程', planJson?: Plan) {
    const token = beginNavigation()
    loading.value = true
    try {
      const result = await api.plans.create({ title, planJson })
      if (token !== navigation) return null
      clearOtherPlan(result.planId)
      await loadPlan(result.planId, token)
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
      conversations.value = mergeById(conversations.value, [conversation])
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
    plans.value = plans.value.filter((item) => item.id !== id)
    conversations.value = conversations.value.filter((item) => item.planId !== id)
    loadedConversations.delete(id)
    loadedConversationIds.value = [...loadedConversations]
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
    conversations.value = conversations.value.filter((item) => item.id !== id)
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
    expectedRevision?: number
  }, expectedVersion?: number, expectedRevision?: number) {
    ensureOnline()
    const plan = currentPlan.value
    if (!plan) return
    const token = navigation
    await api.plans.updateMeta(plan.id, { ...patch, expectedVersion: expectedVersion ?? patch.expectedVersion ?? plan.version, expectedRevision: expectedRevision ?? patch.expectedRevision ?? plan.revision })
    if (token !== navigation) return
    await loadPlan(plan.id, token)
  }

  function matchingConversation(planId: number) {
    const id = currentConversationId.value
    return conversations.value.some((c) => c.id === id && c.planId === planId) ? id ?? undefined : undefined
  }

  async function refreshAfterMutation(planId: number, conversationId: number | undefined, token: number) {
    if (token !== navigation || currentPlan.value?.id !== planId) return
    await loadPlan(planId, token)
    if (token === navigation && conversationId === currentConversationId.value) await reloadConversation()
  }

  function ensureOnline() {
    if (offline.value) throw new Error('当前为离线快照，草稿可以保留；请恢复连接并刷新后再保存或生成。')
  }

  async function savePlan(planJson?: Plan, expectedVersion?: number, expectedRevision?: number) {
    ensureOnline()
    const plan = currentPlan.value
    if (!plan) return null
    const token = navigation
    const conversationId = matchingConversation(plan.id)
    errorMessage.value = ''
    const result = await api.plans.save(plan.id, {
      planJson,
      expectedVersion: expectedVersion ?? plan.version,
      expectedRevision: expectedRevision ?? plan.revision,
      conversationId,
    })
    if (token !== navigation) return null
    savedAt.value = new Date()
    await refreshAfterMutation(plan.id, conversationId, token)
    return token === navigation ? result : null
  }

  async function switchVersion(version: number, expectedVersion?: number, expectedRevision?: number) {
    ensureOnline()
    const plan = currentPlan.value
    if (!plan) return
    const token = navigation
    const conversationId = matchingConversation(plan.id)
    errorMessage.value = ''
    await api.plans.switchVersion(plan.id, { version, expectedVersion: expectedVersion ?? plan.version, expectedRevision: expectedRevision ?? plan.revision, conversationId })
    await refreshAfterMutation(plan.id, conversationId, token)
  }

  async function reloadConversation() {
    const conversationId = currentConversationId.value
    const planId = currentPlan.value?.id
    const instance = chat.value
    if (!conversationId || !instance || instance.status === 'streaming' || instance.status === 'submitted') return
    const token = navigation
    const request = ++messagesRequest
    const { conversation, messages, messagePage } = await api.conversations.messagesPage(conversationId)
    if (token !== navigation || request !== messagesRequest || chat.value !== instance || currentConversationId.value !== conversationId) return
    if (conversation.planId !== planId) throw new Error('会话与工作区不匹配，请重新打开会话')
    const firstId = messages[0]?.id ?? Infinity
    const existingIds = new Set(instance.messages.map((message) => message.id))
    const overlaps = messages.some((message) => existingIds.has(`db-${message.id}`))
    const older = overlaps ? instance.messages.filter((message) => message.id.startsWith('db-') && Number(message.id.slice(3)) < firstId) : []
    instance.messages = [...older, ...toWorkbenchMessages(messages)]
    conversations.value = mergeById(conversations.value, [conversation])
    if (!older.length) { messagesCursor = messagePage.nextCursor; messagesHasMore.value = messagePage.hasMore }
  }

  async function refreshRuns(id = currentConversationId.value) {
    const epoch = lifetime
    if (!id) return
    try {
      const result = await api.chatRuns(id)
      if (epoch === lifetime && currentConversationId.value === id) runs.value = result
    } catch { /* 状态辅助信息不可阻断已保存消息的恢复。 */ }
  }

  async function loadOlderMessages() {
    const id = currentConversationId.value
    const instance = chat.value
    if (!id || !instance || !messagesCursor || loadingHistory.value || instance.status !== 'ready') return
    const token = navigation
    loadingHistory.value = true
    try {
      const result = await api.conversations.messagesPage(id, messagesCursor)
      if (token !== navigation || chat.value !== instance) return
      const known = new Set(instance.messages.map((message) => message.id))
      instance.messages = [...toWorkbenchMessages(result.messages).filter((message) => !known.has(message.id)), ...instance.messages]
      messagesCursor = result.messagePage.nextCursor
      messagesHasMore.value = result.messagePage.hasMore
    } finally { if (token === navigation) loadingHistory.value = false }
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
      void refreshRuns(conversationId)
    }, 500)
  }

  async function sendMessage(text: string) {
    ensureOnline()
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
    requestId = pendingSubmission?.conversationId === currentConversationId.value && pendingSubmission.text === text
      ? pendingSubmission.requestId : crypto.randomUUID()
    pendingSubmission = { conversationId: currentConversationId.value, text, requestId }
    await instance.sendMessage({ text })
    if (chat.value !== instance) return null
    if (!errorMessage.value) pendingSubmission = null
    return errorMessage.value ? null : true
  }

  async function bootstrap() {
    const token = navigation
    loadUi()
    await loadPlans()
    if (token !== navigation) return
    const recent = plans.value[0]
    if (recent) await action(openWorkspace)(recent.id)
  }

  function resetWorkspace() {
    resetting = true
    lifetime++
    clearTimeout(searchTimer)
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
    offline.value = false
    plansCursor = versionsCursor = messagesCursor = null
    plansHasMore.value = versionsHasMore.value = messagesHasMore.value = false
    conversationsHasMore.value = {}
    conversationCursors.clear()
    conversationRequests.clear()
    conversationQueries.clear()
    loadingConversations.clear()
    loadedConversations.clear()
    loadedConversationIds.value = []
    versionsRevision = -1
    versionsRequest++
    loadingVersions.value = loadingHistory.value = false
    runs.value = []
    pendingSubmission = null
    appliedKeyword = appliedPlanQuery = ''
    loadingPlans.value = false
    resetting = false
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
    offline,
    plansHasMore,
    loadingPlans,
    conversationsHasMore,
    versionsHasMore,
    messagesHasMore,
    loadingHistory,
    loadingVersions,
    runs,
    loadMorePlans: action(() => loadPlans(true)),
    loadMoreConversations: action((id: number) => loadConversations(id, true)),
    loadVersions: action(loadVersions),
    loadOlderMessages: action(loadOlderMessages),
    refreshRuns,
    refreshCurrentPlan: action(async () => { if (currentPlan.value) await loadPlan(currentPlan.value.id) }),
    errorMessage,
    savedAt,
    uiLeftOpen,
    mainMode,
    keyword,
    sortOrder,
    workspaces,
    isExpanded,
    isConversationsLoaded: (id: number) => loadedConversationIds.value.includes(id),
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
    retryMessage: action((text: string) => { pendingSubmission = null; return sendMessage(text) }),
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

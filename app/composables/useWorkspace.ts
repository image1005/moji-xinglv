import { createWorkspaceChat } from '../features/workspace/chat-session'
import { createWorkspaceDocument } from '../features/workspace/document'
import { createAttachmentDrafts } from '../features/workspace/attachments'
import { createPlanResources } from '../features/workspace/resources'
import { createWorkspaceCatalog, mergeById } from '../features/workspace/catalog'
import { createModelSettings } from '../features/workspace/model-settings'
import type { Plan } from '#shared/schemas/plan'
import {
  api,
  apiErrorMessage,
} from '~/utils/api'

type MainMode = 'chat' | 'plan' | 'settings'


// Chat 含非序列化状态，按 Nuxt app 实例缓存，不能放模块单例或 useState。
const workspacesByApp = new WeakMap<object, ReturnType<typeof createWorkspaceState>>()

function createWorkspaceState() {
  const catalog = createWorkspaceCatalog({ lifetime: () => lifetime, action })
  const { plans, conversations, plansHasMore, loadingPlans, conversationsHasMore, keyword, sortOrder, expanded, conversationsByPlan, workspaces, loadedConversationIds, loadUi, persistUi, isExpanded, toggleExpanded, toggleSort, loadPlans, loadConversations } = catalog
  const modelSettings = createModelSettings()
  const attachmentDrafts = createAttachmentDrafts()
  const planResources = createPlanResources()
  const loading = ref(false)
  const errorMessage = ref('')
  const document = createWorkspaceDocument({ navigation: () => navigation, lifetime: () => lifetime, conversationId: () => currentConversationId.value, matchingConversation, reloadConversation: () => reloadConversation(), rememberPlan: (plan) => { plans.value = mergeById(plans.value, [plan]) }, errorMessage })
  const { versions, currentPlan, offline, savedAt, loadingVersions, versionsHasMore, clearOtherPlan, loadPlan, loadVersions, updatePlanMeta, savePlan, switchVersion, ensureOnline, refreshAfterMutation } = document
  const session = createWorkspaceChat({ navigation: () => navigation, lifetime: () => lifetime, currentPlan, loading, errorMessage, conversations, modelSettings, ensureOnline, newSession, refreshAfterMutation })
  const { chat, currentConversationId, messagesHasMore, loadingHistory, runs, processingStatus, selectConversation, sendMessage, retryMessage, reloadConversation, refreshRuns, loadOlderMessages, stop } = session
  const uiLeftOpen = ref(false)
  const mainMode = ref<MainMode>('chat')
  let navigation = 0
  let lifetime = 0

  function beginNavigation(clearChat = true) {
    navigation++
    document.invalidate()
    session.invalidate()
    if (clearChat) session.clear()
    savedAt.value = null
    errorMessage.value = ''
    loading.value = false
    return navigation
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

  async function openWorkspace(planId: number, opts: { conversationId?: number } = {}) {
    const preferred = opts.conversationId ?? currentConversationId.value
    if (currentPlan.value?.id === planId && preferred === currentConversationId.value && chat.value) { mainMode.value = 'chat'; return }
    const token = beginNavigation()
    clearOtherPlan(planId)
    mainMode.value = 'chat'
    loading.value = true
    // Publish the navigation state before I/O so restoration cannot toggle a folder
    // underneath a user click or overwrite a collapse made while loading.
    expanded.value = { ...expanded.value, [planId]: true }
    persistUi()
    try {
      await Promise.all([loadPlan(planId, token), loadConversations(planId)])
      if (token !== navigation) return
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
    catalog.forgetPlan(id)
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

  function matchingConversation(planId: number) {
    const id = currentConversationId.value
    return conversations.value.some((c) => c.id === id && c.planId === planId) ? id ?? undefined : undefined
  }

  async function bootstrap() {
    const token = navigation
    loadUi()
    void modelSettings.load()
    await loadPlans()
    if (token !== navigation) return
    const recent = plans.value[0]
    if (recent) await action(openWorkspace)(recent.id)
  }

  function resetWorkspace() {
    lifetime++
    catalog.reset()
    document.reset()
    modelSettings.reset()
    attachmentDrafts.reset()
    planResources.reset()
    session.reset()
    beginNavigation()
    errorMessage.value = ''
    mainMode.value = 'chat'
    uiLeftOpen.value = false
  }

  return {
    modelSettings,
    attachmentDrafts,
    planResources,
    processingStatus,
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
    retryMessage: action(retryMessage),
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

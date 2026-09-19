import { computed, ref, watch } from 'vue'
import { api, type ConversationItem, type PlanListItem } from '~/utils/api'
export type SortOrder = 'updated' | 'created'
const EXPAND_KEY = 'guofeng:expanded-workspaces'
const SORT_KEY = 'guofeng:workspace-sort'
export function mergeById<T extends { id: number }>(old: T[], fresh: T[]): T[] {
  return [...new Map([...old, ...fresh].map((item) => [item.id, item])).values()]
}

/** List ownership, scoped cursors and navigation preferences. Never a module singleton. */
export function createWorkspaceCatalog(context: { lifetime: () => number; action: <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => (...args: A) => Promise<R | null> }) {

  const plans = ref<PlanListItem[]>([])
  const conversations = ref<ConversationItem[]>([])
  const plansHasMore = ref(false)
  const loadingPlans = ref(false)
  const conversationsHasMore = ref<Record<number, boolean>>({})
  const keyword = ref('')
  const sortOrder = ref<SortOrder>('updated')
  const expanded = ref<Record<number, boolean>>({})
  let plansRequest = 0
  let conversationsRequest = 0
  let plansCursor: string | null = null
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
    if (isExpanded(planId) && !loadedConversations.has(planId)) void context.action(loadConversations)(planId)
  }

  function toggleSort() {
    sortOrder.value = sortOrder.value === 'updated' ? 'created' : 'updated'
    invalidatePlanPages()
    persistUi()
    void context.action(loadPlans)()
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
    searchTimer = setTimeout(() => { void context.action(loadPlans)() }, 250)
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

  async function loadPlans(more = false) {
    const scope = planQuery()
    if (more && (loadingPlans.value || !plansHasMore.value || !plansCursor || appliedPlanQuery !== scope)) return
    const request = ++plansRequest
    const epoch = context.lifetime()
    const query = keyword.value.trim().slice(0, 100)
    loadingPlans.value = true
    if (!more) { plansCursor = null; plansHasMore.value = false }
    try {
      const result = await api.plans.listPage(more ? plansCursor ?? undefined : undefined, query || undefined, sortOrder.value)
      if (epoch === context.lifetime() && request === plansRequest && scope === planQuery()) {
        appliedKeyword = query.toLocaleLowerCase()
        appliedPlanQuery = scope
        plans.value = more ? mergeById(plans.value, result.items) : result.items
        plansCursor = result.nextCursor
        plansHasMore.value = result.hasMore
        for (const item of result.items) {
          if (isExpanded(item.id) && !loadedConversations.has(item.id)) void context.action(loadConversations)(item.id)
        }
      }
    } finally {
      if (epoch === context.lifetime() && request === plansRequest) loadingPlans.value = false
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
    const epoch = context.lifetime()
    loadingConversations.add(scope)
    try {
      const result = await api.conversations.listPage(planId, more ? conversationCursors.get(scope) ?? undefined : undefined, query || undefined)
      if (epoch === context.lifetime() && generation === conversationsRequest && conversationRequests.get(scope) === request) {
        const old = more ? conversations.value : conversations.value.filter((item) => planId !== undefined && item.planId !== planId)
        conversations.value = mergeById(old, result.items)
        conversationCursors.set(scope, result.nextCursor)
        conversationQueries.set(scope, query)
        conversationsHasMore.value = { ...conversationsHasMore.value, [scope]: result.hasMore }
        loadedConversations.add(scope)
        loadedConversationIds.value = [...loadedConversations]
      }
    } finally {
      if (epoch === context.lifetime() && generation === conversationsRequest && conversationRequests.get(scope) === request) loadingConversations.delete(scope)
    }
  }

  function reset() {
    resetting = true
    clearTimeout(searchTimer)
    plansRequest++
    conversationsRequest++
    plans.value = []
    conversations.value = []
    keyword.value = ''
    expanded.value = {}
    sortOrder.value = 'updated'
    plansCursor = null
    plansHasMore.value = false
    loadingPlans.value = false
    conversationsHasMore.value = {}
    conversationCursors.clear()
    conversationRequests.clear()
    conversationQueries.clear()
    loadedConversations.clear()
    loadingConversations.clear()
    loadedConversationIds.value = []
    appliedKeyword = appliedPlanQuery = ''
    resetting = false
    if (import.meta.client) {
      try { localStorage.removeItem(EXPAND_KEY); localStorage.removeItem(SORT_KEY) } catch { /* Logout cannot depend on browser storage. */ }
    }
  }

  function forgetPlan(id: number) {
    loadedConversations.delete(id)
    loadedConversationIds.value = [...loadedConversations]
  }

  return { plans, conversations, plansHasMore, loadingPlans, conversationsHasMore, keyword, sortOrder, expanded, conversationsByPlan, workspaces, loadedConversationIds, loadUi, persistUi, isExpanded, toggleExpanded, toggleSort, loadPlans, loadConversations, reset, forgetPlan }
}

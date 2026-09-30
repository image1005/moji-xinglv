import { ref, type Ref } from 'vue'
import type { Plan } from '#shared/schemas/plan'
import { idbGet, idbSet } from '~/utils/idb'
import { api, type PlanDetail } from '~/utils/api'
import { VersionMetadataSchema, type VersionMetadata } from '../../utils/version-metadata'

/** Document snapshots and revisions stay together; every write uses the existing server transaction. */
export function createWorkspaceDocument(context: {
  navigation: () => number; lifetime: () => number; conversationId: () => number | null
  matchingConversation: (planId: number) => number | undefined
  reloadConversation: () => Promise<void>
  rememberPlan: (plan: PlanDetail) => void
  errorMessage: Ref<string>
}) {

  const versions = ref<VersionMetadata[]>([])
  const currentPlan = ref<PlanDetail | null>(null)
  const offline = ref(false)
  const versionsHasMore = ref(false)
  const loadingVersions = ref(false)
  const savedAt = ref<Date | null>(null)
  let planRequest = 0
  let versionsCursor: string | null = null
  let versionsRevision = -1
  let versionsRequest = 0

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

  async function loadPlan(id: number, token = context.navigation()) {
    const request = ++planRequest
    const epoch = context.lifetime()
    const valid = () => epoch === context.lifetime() && token === context.navigation() && request === planRequest
    const cached = await idbGet<PlanDetail>(`plan:${id}`).catch(() => null)
    if (valid() && !currentPlan.value && cached?.id === id && Number.isInteger(cached.revision)) currentPlan.value = cached
    try {
      const plan = await api.plans.detail(id)
      if (!valid()) return false
      currentPlan.value = plan
      offline.value = false
      context.rememberPlan(plan)
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

  function mergeVersions(incoming: VersionMetadata[]) {
    const merged = new Map(versions.value.map(item => [item.id, item]))
    for (const raw of incoming) {
      const item = VersionMetadataSchema.parse(raw)
      const known = merged.get(item.id)
      // A list request started before a rename must not undo the returned name.
      merged.set(item.id, known && known.nameRevision > item.nameRevision
        ? { ...item, name: known.name, nameSource: known.nameSource, nameRevision: known.nameRevision }
        : item)
    }
    versions.value = [...merged.values()].sort((a, b) => b.version - a.version)
  }

  async function loadVersions(more = false, force = false) {
    const plan = currentPlan.value
    if (!plan || offline.value || (!force && loadingVersions.value) || (!more && !force && versionsRevision === plan.revision)) return false
    if (more && !versionsHasMore.value) return false
    const token = context.navigation()
    const epoch = context.lifetime()
    const request = ++versionsRequest
    const valid = () => epoch === context.lifetime() && token === context.navigation() && request === versionsRequest && currentPlan.value?.id === plan.id
    const oldestLoaded = versions.value.at(-1)?.version
    loadingVersions.value = true
    try {
      let result = await api.plans.versionsPage(plan.id, more ? versionsCursor ?? undefined : undefined)
      const items = [...result.items]
      const cursors = new Set<string>()
      // Refresh the entire loaded window, including names on older pages. Renaming
      // does not increment the plan revision, so callers can explicitly force this.
      while (valid() && !more && oldestLoaded !== undefined && result.hasMore && result.nextCursor
        && result.items.length && Math.min(...result.items.map(item => item.version)) > oldestLoaded) {
        if (cursors.has(result.nextCursor)) throw new Error('历史分页游标未推进，请重试。')
        cursors.add(result.nextCursor)
        result = await api.plans.versionsPage(plan.id, result.nextCursor)
        items.push(...result.items)
      }
      if (!valid()) return false
      mergeVersions(items)
      versionsCursor = result.nextCursor
      versionsHasMore.value = result.hasMore
      versionsRevision = plan.revision
      // An AI edit may complete while the list is loading. Its watcher cannot
      // start another request until this one settles, so reconcile it here.
      if (currentPlan.value?.revision !== plan.revision) {
        loadingVersions.value = false
        return loadVersions(false, true)
      }
      return true
    } catch (error) {
      if (!valid()) return false
      throw error
    } finally {
      if (request === versionsRequest) loadingVersions.value = false
    }
  }

  // These two methods report errors to the dialog, where the name draft and its
  // independent optimistic lock can be retained without replacing plan state.
  async function refreshVersionMetadata(version: number) {
    ensureOnline()
    const plan = currentPlan.value
    if (!plan) return null
    const token = context.navigation()
    const epoch = context.lifetime()
    const valid = () => token === context.navigation() && epoch === context.lifetime() && currentPlan.value?.id === plan.id
    let cursor: string | undefined
    const cursors = new Set<string>()
    do {
      const result = await api.plans.versionsPage(plan.id, cursor)
      if (!valid()) return null
      const item = result.items.find(item => item.version === version)
      // Do not insert unrequested pages: opening a preview cannot change node count.
      mergeVersions(result.items.filter(item => versions.value.some(known => known.id === item.id)))
      if (item) return versions.value.find(known => known.id === item.id) ?? VersionMetadataSchema.parse(item)
      if (!result.hasMore || !result.nextCursor) break
      if (cursors.has(result.nextCursor)) throw new Error('历史分页游标未推进，请重试。')
      cursor = result.nextCursor
      cursors.add(cursor)
    } while (valid())
    if (!valid()) return null
    throw new Error('未找到该版本的名称信息，请刷新版本列表。')
  }

  async function renameVersion(version: number, name: string, expectedNameRevision: number) {
    ensureOnline()
    const plan = currentPlan.value
    if (!plan) return null
    const token = context.navigation()
    const epoch = context.lifetime()
    const result = await api.plans.renameVersion(plan.id, version, { name, expectedNameRevision })
    if (token !== context.navigation() || epoch !== context.lifetime() || currentPlan.value?.id !== plan.id) return null
    mergeVersions([result.version])
    return versions.value.find(item => item.id === result.version.id) ?? result.version
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
    const token = context.navigation()
    await api.plans.updateMeta(plan.id, { ...patch, expectedVersion: expectedVersion ?? patch.expectedVersion ?? plan.version, expectedRevision: expectedRevision ?? patch.expectedRevision ?? plan.revision })
    if (token !== context.navigation()) return
    await loadPlan(plan.id, token)
  }

  async function refreshAfterMutation(planId: number, conversationId: number | undefined, token: number) {
    if (token !== context.navigation() || currentPlan.value?.id !== planId) return
    await loadPlan(planId, token)
    if (token === context.navigation() && conversationId === context.conversationId()) await context.reloadConversation()
  }

  function ensureOnline() {
    if (offline.value) throw new Error('当前为离线快照，草稿可以保留；请恢复连接并刷新后再保存或生成。')
  }

  async function savePlan(planJson?: Plan, expectedVersion?: number, expectedRevision?: number) {
    ensureOnline()
    const plan = currentPlan.value
    if (!plan) return null
    const token = context.navigation()
    const conversationId = context.matchingConversation(plan.id)
    context.errorMessage.value = ''
    const result = await api.plans.save(plan.id, {
      planJson,
      expectedVersion: expectedVersion ?? plan.version,
      expectedRevision: expectedRevision ?? plan.revision,
      conversationId,
    })
    if (token !== context.navigation()) return null
    savedAt.value = new Date()
    await refreshAfterMutation(plan.id, conversationId, token)
    return token === context.navigation() ? result : null
  }

  async function switchVersion(version: number, expectedVersion?: number, expectedRevision?: number) {
    ensureOnline()
    const plan = currentPlan.value
    if (!plan) return
    const token = context.navigation()
    const conversationId = context.matchingConversation(plan.id)
    context.errorMessage.value = ''
    await api.plans.switchVersion(plan.id, { version, expectedVersion: expectedVersion ?? plan.version, expectedRevision: expectedRevision ?? plan.revision, conversationId })
    await refreshAfterMutation(plan.id, conversationId, token)
  }

  function invalidate() { planRequest++ }

  function reset() {
    planRequest++
    versionsRequest++
    versions.value = []
    currentPlan.value = null
    offline.value = false
    savedAt.value = null
    versionsCursor = null
    versionsRevision = -1
    versionsHasMore.value = loadingVersions.value = false
  }

  return { versions, currentPlan, offline, savedAt, loadingVersions, versionsHasMore, clearOtherPlan, loadPlan, loadVersions, refreshVersionMetadata, renameVersion, updatePlanMeta, savePlan, switchVersion, ensureOnline, refreshAfterMutation, invalidate, reset }
}

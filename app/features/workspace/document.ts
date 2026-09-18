import { ref, type Ref } from 'vue'
import type { Plan } from '#shared/schemas/plan'
import { idbGet, idbSet } from '~/utils/idb'
import { api, type PlanDetail, type VersionItem } from '~/utils/api'
import { mergeById } from './catalog'

/** Document snapshots and revisions stay together; every write uses the existing server transaction. */
export function createWorkspaceDocument(context: {
  navigation: () => number; lifetime: () => number; conversationId: () => number | null
  matchingConversation: (planId: number) => number | undefined
  reloadConversation: () => Promise<void>
  rememberPlan: (plan: PlanDetail) => void
  errorMessage: Ref<string>
}) {

  const versions = ref<VersionItem[]>([])
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

  async function loadVersions(more = false) {
    const plan = currentPlan.value
    if (!plan || offline.value || loadingVersions.value || (!more && versionsRevision === plan.revision)) return false
    const token = context.navigation()
    const request = ++versionsRequest
    loadingVersions.value = true
    try {
      const result = await api.plans.versionsPage(plan.id, more ? versionsCursor ?? undefined : undefined)
      if (token !== context.navigation() || request !== versionsRequest || currentPlan.value?.id !== plan.id) return false
      versions.value = mergeById(more || versions.value.length ? versions.value : [], result.items).sort((a, b) => b.version - a.version)
      versionsCursor = result.nextCursor
      versionsHasMore.value = result.hasMore
      versionsRevision = plan.revision
      return true
    } finally {
      if (request === versionsRequest) loadingVersions.value = false
    }
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

  return { versions, currentPlan, offline, savedAt, loadingVersions, versionsHasMore, clearOtherPlan, loadPlan, loadVersions, updatePlanMeta, savePlan, switchVersion, ensureOnline, refreshAfterMutation, invalidate, reset }
}

import { ref } from 'vue'
import { PlanResourcesSchema, type PlanResources } from '#shared/schemas/media'
import { apiErrorMessage } from '~/utils/api'

/** Resource status is independent of editable plan versions. All writes bind revision + stable entity ID. */
export function createPlanResources() {
  const records = ref<Record<number, PlanResources>>({})
  const failures = ref<Record<number, string>>({})
  const active = ref<Record<number, string[]>>({})
  const fetching = new Map<number, Promise<void>>()
  const batches = new Set<number>()
  const attempted = new Map<string, Set<string>>()
  let generation = 0

  async function enrich(planId: number, revision: number, entityId?: string, retry = true) {
    const current = records.value[planId]
    if (!current || current.revision !== revision || batches.has(planId)) return
    batches.add(planId)
    const epoch = generation
    const attemptKey = `${planId}:${revision}`
    const tried = attempted.get(attemptKey) ?? new Set<string>()
    if (retry && !entityId) tried.clear()
    attempted.set(attemptKey, tried)
    const entries = entityId ? current.resources.filter(item => item.entityId === entityId) : current.resources.filter(item => (item.status === 'pending' || retry && item.status === 'failed') && !tried.has(item.entityId)).slice(0, 12)
    const queue = entries.filter(item => !active.value[planId]?.includes(item.entityId))
    let failed = false
    failures.value[planId] = ''
    const worker = async () => {
      while (queue.length && epoch === generation && records.value[planId]?.revision === revision) {
        const entry = queue.shift()!
        tried.add(entry.entityId)
        active.value[planId] = [...(active.value[planId] ?? []), entry.entityId]
        try {
          const result = PlanResourcesSchema.parse(await $fetch(`/api/plans/${planId}/resources`, { method: 'POST', body: { expectedRevision: revision, entityId: entry.entityId } }))
          const saved = records.value[planId]
          if (epoch !== generation || saved?.revision !== revision || result.revision !== revision) return
          // Parallel responses cannot erase each other's completed resource.
          const replacement = result.resources.find(item => item.entityId === entry.entityId)
          if (replacement) records.value[planId] = { ...saved, resources: saved.resources.map(item => item.entityId === entry.entityId ? replacement : item) }
        } catch (error) {
          failed = true
          if (epoch === generation && records.value[planId]?.revision === revision) failures.value[planId] = apiErrorMessage(error, '资源加载失败，可以重试')
          queue.length = 0
        } finally {
          if (epoch === generation) active.value[planId] = (active.value[planId] ?? []).filter(id => id !== entry.entityId)
        }
      }
    }
    try { await Promise.all([worker(), worker()]) }
    finally {
      if (epoch === generation) {
        batches.delete(planId)
        const latest = records.value[planId]
        if (latest && (latest.revision !== revision || !failed && latest.resources.some(item => item.status === 'pending' && !tried.has(item.entityId)))) await enrich(planId, latest.revision, undefined, false)
      }
    }
  }

  async function load(planId: number, revision: number, force = false) {
    const epoch = generation
    if (force) attempted.delete(`${planId}:${revision}`)
    if (records.value[planId]?.revision === revision && !force) return
    if (fetching.has(planId)) { await fetching.get(planId); if (epoch === generation && records.value[planId]?.revision !== revision) return load(planId, revision); return }
    const pending = (async () => {
      try {
        const result = PlanResourcesSchema.parse(await $fetch(`/api/plans/${planId}/resources`))
        if (epoch !== generation || result.revision !== revision) return
        records.value[planId] = result
        failures.value[planId] = ''
        void enrich(planId, revision, undefined, force)
      } catch (error) { if (epoch === generation) failures.value[planId] = apiErrorMessage(error, '图片与地点资料暂未取得') }
      finally { if (epoch === generation) fetching.delete(planId) }
    })()
    fetching.set(planId, pending)
    await pending
  }

  function reset() { generation++; records.value = {}; failures.value = {}; active.value = {}; fetching.clear(); batches.clear(); attempted.clear() }
  return { records, failures, active, load, enrich, reset }
}

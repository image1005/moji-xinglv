import { ref, shallowRef, watch } from 'vue'
import type { Plan } from '#shared/schemas/plan'

/** Metadata merges replace objects without selecting a different snapshot. */
export function watchVersionSelection(planId: () => number, version: () => number, onSelect: () => void) {
  return watch([planId, version], onSelect, { immediate: true })
}

/** A preview owns its snapshot; late responses can never replace a newer selection. */
export function createVersionPreview(loadSnapshot: (planId: number, version: number) => Promise<{ plan: Plan | null }>) {
  const plan = shallowRef<Plan | null>(null)
  const loading = ref(false)
  const error = shallowRef<unknown>(null)
  let request = 0

  async function load(planId: number, version: number) {
    const token = ++request
    plan.value = null
    error.value = null
    loading.value = true
    try {
      const result = await loadSnapshot(planId, version)
      if (token === request) plan.value = result.plan
    } catch (cause) {
      if (token === request) error.value = cause
    } finally {
      if (token === request) loading.value = false
    }
  }

  function invalidate() {
    request++
    loading.value = false
    plan.value = null
    error.value = null
  }

  return { plan, loading, error, load, invalidate }
}

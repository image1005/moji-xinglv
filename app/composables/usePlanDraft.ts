import { draftKey, readDraft, writeDraft } from '~/utils/draft-storage'

/** KeepAlive views only observe the plan and user they were created for. */
export function useBoundPlan() {
  const { currentPlan } = useWorkspace()
  const { user } = useCurrentUser()
  const planId = currentPlan.value?.id
  const owner = user.value?.id
  const plan = shallowRef(currentPlan.value)
  watch([currentPlan, () => user.value?.id], () => {
    if (user.value?.id !== owner) plan.value = null
    else if (currentPlan.value?.id === planId) plan.value = currentPlan.value
  }, { flush: 'sync' })
  return plan
}

export function usePlanDraft<T>(planId: number | null | undefined, object: string, validate: (value: unknown) => T | null) {
  const { user } = useCurrentUser()
  const owner = user.value?.id
  const key = owner && planId !== undefined ? draftKey(owner, planId, object) : null
  const persisted = ref(false)
  const storageError = ref('')
  let pending: T | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const ownsDraft = () => !!key && user.value?.id === owner

  function flush() {
    clearTimeout(timer)
    timer = undefined
    if (typeof window === 'undefined' || !key || !ownsDraft() || pending === null) return
    try {
      writeDraft(localStorage, key, pending)
      persisted.value = true
      storageError.value = ''
    } catch {
      persisted.value = false
      storageError.value = '浏览器无法保存本地草稿，请在离开前保存行程。'
    }
  }
  function save(value: T) {
    if (!ownsDraft()) return
    pending = value
    persisted.value = false
    clearTimeout(timer)
    timer = setTimeout(flush, 250)
  }
  function restore() {
    if (typeof window === 'undefined' || !key || !ownsDraft()) return null
    try {
      const value = readDraft(localStorage, key, validate)
      persisted.value = value !== null
      return value
    } catch { return null }
  }
  function clear() {
    clearTimeout(timer)
    pending = null
    persisted.value = false
    if (typeof window !== 'undefined' && key && ownsDraft()) {
      try { localStorage.removeItem(key) } catch { /* Keep in-memory edits usable. */ }
    }
  }
  onMounted(() => {
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
  })
  onDeactivated(flush)
  onBeforeUnmount(() => {
    flush()
    window.removeEventListener('pagehide', flush)
    window.removeEventListener('beforeunload', flush)
  })
  watch(() => user.value?.id, () => { clearTimeout(timer); pending = null; persisted.value = false }, { flush: 'sync' })
  return { save, restore, clear, flush, persisted, storageError }
}

import type { SessionUser } from '~/utils/api'
import { SessionUserSchema } from '#shared/schemas/workspace'
import { setCacheUser } from '~/utils/idb'

const usersByApp = new WeakMap<object, ReturnType<typeof createCurrentUser>>()

function createCurrentUser() {
  const user = useState<SessionUser | null>('current-user', () => null)
  const loaded = useState('current-user-loaded', () => false)
  const requestFetch = useRequestFetch()
  const { resetWorkspace } = useWorkspace()
  let request = 0
  let pending: Promise<SessionUser | null> | null = null
  if (import.meta.client && user.value) void setCacheUser(user.value.id)

  function applyUser(next: SessionUser | null) {
    if (!next || (user.value && user.value.id !== next.id)) resetWorkspace()
    user.value = next
    if (import.meta.client) void setCacheUser(next?.id ?? null)
  }

  async function loadMe(force = false) {
    if (loaded.value && !force) return user.value
    if (pending && !force) return pending
    const token = ++request
    pending = (async () => {
      try {
        // SSR 转发当前请求的 Cookie，不能使用未绑定请求的全局 $fetch。
        const result = await requestFetch<{ user: SessionUser }>('/api/me')
        if (token === request) applyUser(SessionUserSchema.parse(result.user))
      } catch {
        if (token === request) applyUser(null)
      } finally {
        if (token === request) {
          loaded.value = true
          pending = null
        }
      }
      return user.value
    })()
    return pending
  }

  function clearUser() {
    request++
    pending = null
    user.value = null
    loaded.value = false
    resetWorkspace()
    if (import.meta.client) void setCacheUser(null)
  }

  return { user, loaded, loadMe, clearUser }
}

export function useCurrentUser() {
  const app = useNuxtApp()
  let currentUser = usersByApp.get(app)
  if (!currentUser) {
    currentUser = createCurrentUser()
    usersByApp.set(app, currentUser)
  }
  return currentUser
}

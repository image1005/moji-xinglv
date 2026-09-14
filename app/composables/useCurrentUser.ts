import type { SessionUser } from '~/utils/api'

export function useCurrentUser() {
  const user = useState<SessionUser | null>('current-user', () => null)
  const loaded = useState('current-user-loaded', () => false)

  async function loadMe(force = false) {
    if (loaded.value && !force) return user.value
    try {
      const result = await api.me()
      user.value = result.user
    } catch {
      user.value = null
    }
    loaded.value = true
    return user.value
  }

  function clearUser() {
    user.value = null
    loaded.value = false
  }

  return { user, loaded, loadMe, clearUser }
}

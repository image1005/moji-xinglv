import { authClient } from '~/utils/auth-client'

export default defineNuxtRouteMiddleware(async (to) => {
  const { data: session } = await authClient.useSession(useFetch)
  if (!session.value) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
  const role = (session.value.user as { role?: string | null }).role
  if (role !== 'admin') {
    return navigateTo('/')
  }
})

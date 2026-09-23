export default defineNuxtRouteMiddleware(async (to) => {
  // Wait for the current server identity instead of a stale sign-out session cache.
  const user = await useCurrentUser().loadMe(true)
  if (!user) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})

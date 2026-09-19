export default defineNuxtRouteMiddleware(async (to) => {
  const user = await useCurrentUser().loadMe(true)
  if (!user) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
  if (user.role !== 'admin') {
    return navigateTo('/')
  }
})

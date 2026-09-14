import { sendRedirect } from 'h3'
import { getSessionUser } from '../utils/session'

/**
 * /admin HTML 路由守卫（硬约束 9：routeRules 的等价服务端实现 + API 双重校验）。
 * API 侧仍有 requireAdmin 兜底。
 */
export default defineEventHandler(async (event) => {
  const path = event.path
  if (!path.startsWith('/admin') || path.startsWith('/api')) return
  const user = await getSessionUser(event)
  if (!user || user.role !== 'admin') {
    return sendRedirect(event, `/login?redirect=${encodeURIComponent(path)}`)
  }
})

import type { H3Event } from 'h3'
import { createError } from 'h3'
import { auth } from './auth'

/** 服务端会话与 RBAC（硬约束 9：以服务端为准） */

export interface SessionUser {
  id: string
  email: string
  name: string
  role: 'user' | 'admin'
}

export async function getSessionUser(event: H3Event): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) return null
  const user = session.user as typeof session.user & { role?: string | null }
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? '',
    role: user.role === 'admin' ? 'admin' : 'user',
  }
}

export async function requireUser(event: H3Event): Promise<SessionUser> {
  const user = await getSessionUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: '请先登录' })
  return user
}

export async function requireAdmin(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event)
  if (user.role !== 'admin') throw createError({ statusCode: 403, statusMessage: '需要管理员权限' })
  return user
}

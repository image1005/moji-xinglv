import { count, desc } from 'drizzle-orm'
import { plans, user } from '../../database/schema'
import { db } from '../../utils/db'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const planCounts = await db
    .select({ userId: plans.userId, c: count() })
    .from(plans)
    .groupBy(plans.userId)
  const planMap = new Map(planCounts.map((r) => [r.userId, Number(r.c)]))
  const users = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt))
  return users.map((u) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
    planCount: planMap.get(u.id) ?? 0,
  }))
})

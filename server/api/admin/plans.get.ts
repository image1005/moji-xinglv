import { desc, eq } from 'drizzle-orm'
import { plans, user } from '../../database/schema'
import { db } from '../../utils/db'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const rows = await db
    .select({
      id: plans.id,
      title: plans.title,
      summary: plans.summary,
      updatedAt: plans.updatedAt,
      userEmail: user.email,
    })
    .from(plans)
    .leftJoin(user, eq(plans.userId, user.id))
    .orderBy(desc(plans.updatedAt))
    .limit(200)
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }))
})

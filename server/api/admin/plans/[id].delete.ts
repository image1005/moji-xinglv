import { eq } from 'drizzle-orm'
import { plans } from '../../../database/schema'
import { db } from '../../../utils/db'
import { requireAdmin } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'id 不合法' })
  await db.delete(plans).where(eq(plans.id, id))
  return { ok: true }
})

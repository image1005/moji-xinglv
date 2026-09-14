import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { user } from '../../../database/schema'
import { db } from '../../../utils/db'
import { requireAdmin } from '../../../utils/session'

const BodySchema = z.object({
  role: z.enum(['user', 'admin']).optional(),
  banned: z.boolean().optional(),
  banReason: z.string().max(200).optional(),
})

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id 不合法' })
  if (id === admin.id) throw createError({ statusCode: 400, statusMessage: '不能修改自己的角色或封禁状态' })
  const body = await readValidatedBody(event, BodySchema.parse)
  await db
    .update(user)
    .set({
      role: body.role,
      banned: body.banned,
      banReason: body.banned ? (body.banReason ?? '违反使用条款') : null,
    })
    .where(eq(user.id, id))
  return { ok: true }
})

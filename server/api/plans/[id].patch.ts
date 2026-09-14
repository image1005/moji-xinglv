import { z } from 'zod'
import { updatePlanMeta } from '../../services/plan'
import { requireUser } from '../../utils/session'

const BodySchema = z.object({
  title: z.string().min(1).max(80).optional(),
  summary: z.string().max(500).optional(),
  contentMd: z.string().max(50000).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'id 不合法' })
  const body = await readValidatedBody(event, BodySchema.parse)
  await updatePlanMeta(user.id, id, body)
  return { ok: true }
})

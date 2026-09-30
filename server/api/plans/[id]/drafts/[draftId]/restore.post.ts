import { z } from 'zod'
import { restorePlanDraft } from '../../../../../services/plan'
import { requireUser } from '../../../../../utils/session'

const BodySchema = z.object({
  expectedRevision: z.number().int().positive(),
  expectedVersion: z.number().int().nonnegative().optional(),
  conversationId: z.number().int().positive().optional(),
})

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  const draftId = Number(getRouterParam(event, 'draftId'))
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(draftId) || draftId <= 0) throw createError({ statusCode: 400, statusMessage: '参数不合法' })
  const body = await readValidatedBody(event, BodySchema.parse)
  return restorePlanDraft(user.id, id, draftId, body)
})

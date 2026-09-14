import { z } from 'zod'
import { createConversation } from '../../services/conversation'
import { requireUser } from '../../utils/session'

const BodySchema = z.object({
  planId: z.number().int().positive(),
  title: z.string().min(1).max(60).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, BodySchema.parse)
  return createConversation(user.id, body.planId, body.title)
})

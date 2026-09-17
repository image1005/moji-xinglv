import { z } from 'zod'
import { getConversation } from '../../../services/conversation'
import { switchToVersion } from '../../../services/plan'
import { requireUser } from '../../../utils/session'

const BodySchema = z.object({
  version: z.number().int().positive(),
  conversationId: z.number().int().positive().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  expectedRevision: z.number().int().positive().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'id 不合法' })
  const body = await readValidatedBody(event, BodySchema.parse)
  if (body.conversationId !== undefined) {
    const conversation = await getConversation(user.id, body.conversationId)
    if (conversation.planId !== id) {
      throw createError({ statusCode: 404, statusMessage: '会话不属于当前规划' })
    }
  }
  const result = await switchToVersion(user.id, id, body.version, {
    expectedVersion: body.expectedVersion,
    expectedRevision: body.expectedRevision,
    conversationId: body.conversationId,
  })
  return result
})

import { z } from 'zod'
import { appendMessage, getConversation } from '../../../services/conversation'
import { rollbackToVersion } from '../../../services/plan'
import { requireUser } from '../../../utils/session'

const BodySchema = z.object({
  version: z.number().int().positive(),
  conversationId: z.number().int().positive().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'id 不合法' })
  const body = await readValidatedBody(event, BodySchema.parse)
  const result = await rollbackToVersion(user.id, id, body.version)
  if (body.conversationId) {
    const conversation = await getConversation(user.id, body.conversationId)
    if (conversation.planId === id) {
      await appendMessage(body.conversationId, {
        role: 'system',
        content: `已回滚到 v${body.version}，基于该版本新建 v${result.version}（历史版本保留）`,
        preview: result.preview,
        planVersionId: result.versionId,
      })
    }
  }
  return result
})

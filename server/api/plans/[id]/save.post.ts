import { z } from 'zod'
import { appendMessage, getConversation } from '../../../services/conversation'
import { savePlanVersion } from '../../../services/plan'
import { requireUser } from '../../../utils/session'

const BodySchema = z.object({
  planJson: z.unknown().optional(),
  conversationId: z.number().int().positive().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'id 不合法' })
  const body = await readValidatedBody(event, BodySchema.parse)
  const result = await savePlanVersion(user.id, id, {
    planJson: body.planJson,
    source: 'user',
    note: '手动保存',
  })
  if (body.conversationId) {
    const conversation = await getConversation(user.id, body.conversationId)
    if (conversation.planId === id) {
      await appendMessage(body.conversationId, {
        role: 'system',
        content: result.skipped ? '内容无变化，未生成新版本' : `已保存为 v${result.version}`,
        preview: result.preview,
        planVersionId: result.versionId,
      })
    }
  }
  return result
})

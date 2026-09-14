import { getConversation, listMessages } from '../../services/conversation'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'id 不合法' })
  const conversation = await getConversation(user.id, id)
  const messages = await listMessages(id)
  return { conversation: { ...conversation, createdAt: conversation.createdAt.toISOString(), updatedAt: conversation.updatedAt.toISOString() }, messages }
})

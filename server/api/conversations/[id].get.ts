import { getConversation, listMessages, listMessagesPage } from '../../services/conversation'
import { PageQuerySchema } from '../../services/pagination'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'id 不合法' })
  const query = await getValidatedQuery(event, PageQuerySchema.parse)
  const conversation = await getConversation(user.id, id)
  const record = { ...conversation, createdAt: conversation.createdAt.toISOString(), updatedAt: conversation.updatedAt.toISOString() }
  if (query.paged) {
    const page = await listMessagesPage(user.id, id, query)
    return { conversation: record, messages: page.items, messagePage: { nextCursor: page.nextCursor, hasMore: page.hasMore } }
  }
  return { conversation: record, messages: await listMessages(id) }
})

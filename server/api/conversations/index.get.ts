import { z } from 'zod'
import { listConversations, listConversationsPage } from '../../services/conversation'
import { PageQuerySchema } from '../../services/pagination'
import { requireUser } from '../../utils/session'

const QuerySchema = PageQuerySchema.extend({ planId: z.coerce.number().int().positive().optional(), q: z.string().trim().max(100).optional() })

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = await getValidatedQuery(event, QuerySchema.parse)
  return query.paged ? listConversationsPage(user.id, query.planId, query) : listConversations(user.id, query.planId)
})

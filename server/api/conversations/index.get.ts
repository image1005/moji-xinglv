import { z } from 'zod'
import { listConversations } from '../../services/conversation'
import { requireUser } from '../../utils/session'

const QuerySchema = z.object({ planId: z.coerce.number().int().positive().optional() })

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = await getValidatedQuery(event, QuerySchema.parse)
  return listConversations(user.id, query.planId)
})

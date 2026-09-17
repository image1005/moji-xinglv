import { getValidatedQuery } from 'h3'
import { z } from 'zod'
import { listRuns } from '../../services/chat-runs'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const { conversationId } = await getValidatedQuery(event, z.object({ conversationId: z.coerce.number().int().positive() }).parse)
  return listRuns(user.id, conversationId)
})

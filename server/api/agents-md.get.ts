import { z } from 'zod'
import { getAgentsMd } from '../services/agents-md'
import { requireUser } from '../utils/session'

const QuerySchema = z.object({ planId: z.coerce.number().int().positive().optional() })

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = await getValidatedQuery(event, QuerySchema.parse)
  const planId = query.planId ?? null
  const row = await getAgentsMd(user.id, planId)
  return { planId, content: row?.content ?? '', version: row?.version ?? 0 }
})

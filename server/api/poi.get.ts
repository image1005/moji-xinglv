import { z } from 'zod'
import { searchPlanPlaces } from '../services/poi'
import { requireUser } from '../utils/session'

const QuerySchema = z.object({
  planId: z.coerce.number().int().positive(),
  q: z.string().trim().min(1).max(60),
  region: z.string().max(30).default(''),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = await getValidatedQuery(event, QuerySchema.parse)
  return { results: await searchPlanPlaces(user.id, query.planId, query.q, query.region), source: 'current-plan' }
})

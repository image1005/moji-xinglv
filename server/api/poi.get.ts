import { z } from 'zod'
import { searchPoi } from '../services/baidu'
import { requireUser } from '../utils/session'

const QuerySchema = z.object({
  q: z.string().min(1).max(60),
  region: z.string().min(1).max(30),
})

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const query = await getValidatedQuery(event, QuerySchema.parse)
  return { results: await searchPoi(query.q, query.region) }
})

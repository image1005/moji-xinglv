import { listPlans, listPlansPage } from '../../services/plan'
import { PageQuerySchema } from '../../services/pagination'
import { requireUser } from '../../utils/session'
import { z } from 'zod'

const QuerySchema = PageQuerySchema.extend({ q: z.string().trim().max(100).optional(), sort: z.enum(['created', 'updated']).default('updated') })

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = await getValidatedQuery(event, QuerySchema.parse)
  return query.paged ? listPlansPage(user.id, query) : listPlans(user.id)
})

import { listVersions, listVersionsPage } from '../../../services/plan'
import { PageQuerySchema } from '../../../services/pagination'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'id 不合法' })
  const query = await getValidatedQuery(event, PageQuerySchema.parse)
  return query.paged ? listVersionsPage(user.id, id, query) : listVersions(user.id, id, 200)
})

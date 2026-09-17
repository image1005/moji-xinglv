import { StaticMapQuerySchema } from '../../shared/schemas/map'
import { getStaticMapImage } from '../services/baidu'
import { requireUser } from '../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = await getValidatedQuery(event, StaticMapQuerySchema.parse)
  const { buffer, contentType, cached } = await getStaticMapImage(query, user.id)
  setResponseHeaders(event, {
    'content-type': contentType,
    'cache-control': 'private, max-age=86400',
    'x-content-type-options': 'nosniff',
    'x-cache': cached ? 'HIT' : 'MISS',
  })
  return buffer
})

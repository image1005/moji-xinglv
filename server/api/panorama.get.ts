import { PanoramaQuerySchema } from '../../shared/schemas/map'
import { getPanoramaImage } from '../services/baidu'
import { requireUser } from '../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = await getValidatedQuery(event, PanoramaQuerySchema.parse)
  const { buffer, contentType, cached } = await getPanoramaImage(query, user.id)
  setResponseHeaders(event, {
    'content-type': contentType,
    'cache-control': 'private, max-age=86400',
    'x-content-type-options': 'nosniff',
    'x-cache': cached ? 'HIT' : 'MISS',
  })
  return buffer
})

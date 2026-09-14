import { z } from 'zod'
import { getPanoramaImage } from '../services/baidu'
import { requireUser } from '../utils/session'

const QuerySchema = z.object({
  location: z
    .string()
    .regex(/^-?\d{1,3}(\.\d+)?,-?\d{1,2}(\.\d+)?$/, 'location 需为 lng,lat'),
  width: z.coerce.number().int().min(10).max(1024).default(640),
  height: z.coerce.number().int().min(10).max(512).default(360),
  heading: z.coerce.number().min(0).max(360).optional(),
  pitch: z.coerce.number().min(0).max(90).optional(),
  fov: z.coerce.number().min(10).max(360).optional(),
})

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const query = await getValidatedQuery(event, QuerySchema.parse)
  const { buffer, contentType, cached } = await getPanoramaImage(query)
  setResponseHeaders(event, {
    'content-type': contentType,
    'cache-control': 'public, max-age=604800, immutable',
    'x-cache': cached ? 'HIT' : 'MISS',
  })
  return buffer
})

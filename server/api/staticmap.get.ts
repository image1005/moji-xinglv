import { z } from 'zod'
import { getStaticMapImage } from '../services/baidu'
import { requireUser } from '../utils/session'

const ListParam = z.preprocess(
  (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
  z.array(z.string().max(512)).max(50).optional(),
)

const QuerySchema = z.object({
  center: z
    .string()
    .regex(/^-?\d{1,3}(\.\d+)?,-?\d{1,2}(\.\d+)?$/)
    .optional(),
  zoom: z.coerce.number().int().min(3).max(19).optional(),
  width: z.coerce.number().int().min(50).max(1024).default(640),
  height: z.coerce.number().int().min(50).max(1024).default(360),
  scale: z.coerce.number().int().min(1).max(2).optional(),
  markers: ListParam,
  paths: ListParam,
  pathStyles: z.string().max(120).optional(),
})

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const query = await getValidatedQuery(event, QuerySchema.parse)
  const { buffer, contentType, cached } = await getStaticMapImage(query)
  setResponseHeaders(event, {
    'content-type': contentType,
    'cache-control': 'public, max-age=604800, immutable',
    'x-cache': cached ? 'HIT' : 'MISS',
  })
  return buffer
})

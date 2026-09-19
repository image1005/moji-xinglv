import { z } from 'zod'
import { readPlanResourceImage } from '../../../services/media'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.coerce.number().int().positive() }).parse)
  const { entityId, v } = await getValidatedQuery(event, z.object({ entityId: z.string().min(1).max(110), v: z.string().regex(/^[a-z0-9]{1,32}$/).optional() }).parse)
  const bytes = await readPlanResourceImage(user.id, id, entityId, v)
  setHeader(event, 'Content-Type', 'image/webp')
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return send(event, bytes)
})

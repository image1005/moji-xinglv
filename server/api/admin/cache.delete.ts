import { z } from 'zod'
import { clearCache } from '../../services/cache'
import { requireAdmin } from '../../utils/session'

const BodySchema = z.object({ prefix: z.string().min(1).max(80).optional() }).strict()

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readValidatedBody(event, BodySchema.parse)
  const removed = await clearCache(body.prefix)
  return { ok: true, removed }
})

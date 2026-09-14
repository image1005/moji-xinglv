import { z } from 'zod'
import { clearCache } from '../../services/cache'
import { requireAdmin } from '../../utils/session'

const BodySchema = z.object({ prefix: z.string().max(80).optional() })

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readValidatedBody(event, BodySchema.parse).catch(() => ({ prefix: undefined }))
  const removed = await clearCache(body.prefix)
  return { ok: true, removed }
})

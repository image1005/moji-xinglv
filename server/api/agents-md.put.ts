import { z } from 'zod'
import { AGENTS_MD_MAX_LENGTH, saveAgentsMd } from '../services/agents-md'
import { requireUser } from '../utils/session'

const BodySchema = z.object({
  planId: z.number().int().positive().nullable().optional().default(null),
  content: z.string().max(AGENTS_MD_MAX_LENGTH),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, BodySchema.parse)
  const result = await saveAgentsMd(user.id, body.planId, body.content)
  return { ok: true, ...result }
})

import { z } from 'zod'
import { emptyPlan } from '../../../shared/schemas/plan'
import { createPlan, parsePlanJson } from '../../services/plan'
import { requireUser } from '../../utils/session'

const BodySchema = z.object({
  title: z.string().min(1).max(80).optional(),
  planJson: z.unknown().optional(),
  contentMd: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, BodySchema.parse)
  const plan = body.planJson ? parsePlanJson(body.planJson) : emptyPlan(body.title ?? '未命名行程')
  const result = await createPlan(user.id, plan, { source: 'user', contentMd: body.contentMd })
  return result
})

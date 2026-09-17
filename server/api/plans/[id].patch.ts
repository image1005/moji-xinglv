import { z } from 'zod'
import { BudgetSchema } from '../../../shared/schemas/plan'
import { updatePlanMeta } from '../../services/plan'
import { requireUser } from '../../utils/session'

const BodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  summary: z.string().max(4000).optional(),
  // 图片地址的协议限制由 PlanSchema 在合并后统一校验
  cover: z.string().max(2048).optional(),
  tags: z.array(z.string().min(1).max(40)).max(30).optional(),
  tips: z.array(z.string().min(1).max(4000)).max(100).optional(),
  budget: BudgetSchema.optional(),
  contentMd: z.string().max(50000).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  expectedRevision: z.number().int().positive().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'id 不合法' })
  const body = await readValidatedBody(event, BodySchema.parse)
  const result = await updatePlanMeta(user.id, id, body)
  return { ok: true, version: result.version, revision: result.revision, plan: result.plan, contentMd: result.contentMd, skipped: result.skipped }
})

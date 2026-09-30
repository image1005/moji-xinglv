import { PlanDraftDetailSchema } from '../../../../../shared/schemas/workspace'
import { getPlanDraft } from '../../../../services/plan'
import { requireUser } from '../../../../utils/session'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  const draftId = Number(getRouterParam(event, 'draftId'))
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(draftId) || draftId <= 0) throw createError({ statusCode: 400, statusMessage: '参数不合法' })
  const draft = getPlanDraft(user.id, id, draftId)
  return { draft: PlanDraftDetailSchema.parse({ ...draft, createdAt: draft.createdAt.toISOString(), updatedAt: draft.updatedAt.toISOString() }) }
})

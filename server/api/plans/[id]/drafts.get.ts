import { DraftSchema } from '../../../../shared/schemas/workspace'
import { listPlanDrafts } from '../../../services/plan'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'id 不合法' })
  return { drafts: listPlanDrafts(user.id, id).map(draft => DraftSchema.parse({ ...draft,
    createdAt: draft.createdAt.toISOString(), updatedAt: draft.updatedAt.toISOString(),
  })) }
})

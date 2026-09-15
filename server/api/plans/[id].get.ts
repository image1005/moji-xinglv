import { getPlanSnapshot } from '../../services/plan'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'id 不合法' })
  const { row, plan, current } = await getPlanSnapshot(user.id, id)
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    contentMd: row.contentMd,
    coverUrl: row.coverUrl,
    plan,
    version: current?.version ?? 1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
})

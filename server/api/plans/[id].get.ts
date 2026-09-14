import { getLatestVersion, getPlanRow, parsePlanJson } from '../../services/plan'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'id 不合法' })
  const row = await getPlanRow(user.id, id)
  const latest = await getLatestVersion(id)
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    contentMd: row.contentMd,
    coverUrl: row.coverUrl,
    plan: parsePlanJson(row.planJson),
    version: latest?.version ?? 1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
})

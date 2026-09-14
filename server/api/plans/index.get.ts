import { inArray, max } from 'drizzle-orm'
import { planVersions } from '../../database/schema'
import { listPlans } from '../../services/plan'
import { db } from '../../utils/db'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const rows = await listPlans(user.id)
  const ids = rows.map((r) => r.id)
  const versions = ids.length
    ? await db
        .select({ planId: planVersions.planId, version: max(planVersions.version) })
        .from(planVersions)
        .where(inArray(planVersions.planId, ids))
        .groupBy(planVersions.planId)
    : []
  const versionMap = new Map(versions.map((v) => [v.planId, Number(v.version ?? 1)]))
  return rows.map((r) => ({ ...r, version: versionMap.get(r.id) ?? 1 }))
})

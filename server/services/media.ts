import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { PlanResourceSchema, type PlanResource, type PlanResources } from '../../shared/schemas/media'
import { planEntities, type PlanEntity } from '../../shared/utils/plan-entities'
import { planResources, plans } from '../database/schema'
import { db } from '../utils/db'
import { getPlanSnapshot, parsePlanJson } from './plan'
import { locateEntity } from './baidu'
import { acquireWikimediaImage, getResourceImageBytes } from './wikimedia'

const pending = (entity: PlanEntity): PlanResource => ({ entityId: entity.entityId, entityType: entity.entityType, name: entity.name, city: entity.city, status: 'pending', image: null, location: null, error: null })
const imageUrl = (planId: number, entity: PlanEntity) => `/api/plans/${planId}/resource-image?entityId=${encodeURIComponent(entity.entityId)}&v=${entity.fingerprint}`
export async function getPlanResources(userId: string, planId: number): Promise<PlanResources> {
  const snapshot = await getPlanSnapshot(userId, planId)
  const rows = db.select().from(planResources).where(and(eq(planResources.planId, planId), eq(planResources.userId, userId))).all()
  return { revision: snapshot.row.revision, resources: planEntities(snapshot.plan).map(entity => {
    const row = rows.find(value => value.entityId === entity.entityId && value.fingerprint === entity.fingerprint)
    const parsed = PlanResourceSchema.safeParse(row?.resourceJson)
    if (!parsed.success) return pending(entity)
    if (parsed.data.image) parsed.data.image.url = imageUrl(planId, entity)
    return parsed.data
  }) }
}
const running = new Map<string, Promise<void>>()
let active = 0
async function enrichEntity(userId: string, planId: number, revision: number, entity: PlanEntity) {
  const key = `${userId}:${planId}:${revision}:${entity.entityId}`
  const existing = running.get(key)
  if (existing) return existing
  if (active >= 6) throw createError({ statusCode: 429, statusMessage: '图片地点任务繁忙，请稍后重试' })
  active++
  const job = (async () => {
    const previousRow = db.select().from(planResources).where(and(eq(planResources.userId, userId), eq(planResources.planId, planId), eq(planResources.entityId, entity.entityId), eq(planResources.fingerprint, entity.fingerprint))).get()
    const previous = PlanResourceSchema.safeParse(previousRow?.resourceJson)
    const resource = pending(entity)
    const [image, location] = await Promise.allSettled([acquireWikimediaImage(entity, previous.success && !previous.data.image), locateEntity(entity)])
    const acquired = image.status === 'fulfilled' ? image.value : null
    const confirmedImage = acquired?.image ?? (previous.success ? previous.data.image : null)
    resource.image = confirmedImage ? { ...confirmedImage } : null
    resource.location = (location.status === 'fulfilled' ? location.value : null) ?? (previous.success ? previous.data.location : null)
    const failed = image.status === 'rejected' || location.status === 'rejected'
    resource.status = resource.image || resource.location ? 'ready' : failed ? 'failed' : 'not_found'
    const reused = !acquired && resource.image !== null
    resource.error = failed ? '部分资源服务暂不可用，可稍后重试；已有结果仍可查看。' : reused ? '本次未取得新图片，保留同一地点先前已确认的图片。' : resource.status === 'not_found' ? '未找到可确认匹配的图片或地点；请核实名称、城市及地址。' : null
    db.transaction(tx => {
      const row = tx.select().from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId))).get()
      if (!row || row.revision !== revision) throw createError({ statusCode: 409, statusMessage: '规划已修改，已丢弃旧资源查询结果' })
      const current = planEntities(parsePlanJson(row.planJson)).find(value => value.entityId === entity.entityId)
      if (!current || current.fingerprint !== entity.fingerprint) throw createError({ statusCode: 409, statusMessage: '地点已修改，已丢弃旧资源查询结果' })
      if (resource.image) resource.image.url = imageUrl(planId, entity)
      const values = { userId, planId, entityId: entity.entityId, fingerprint: entity.fingerprint, planRevision: revision, resourceJson: resource, imageOriginUrl: acquired?.originUrl ?? (resource.image ? previousRow?.imageOriginUrl : null), imageCacheKey: acquired?.cacheKey ?? (resource.image ? previousRow?.imageCacheKey : null), updatedAt: new Date() }
      tx.insert(planResources).values(values).onConflictDoUpdate({ target: [planResources.planId, planResources.entityId], set: values }).run()
    })
  })().finally(() => { active--; running.delete(key) })
  running.set(key, job)
  return job
}
export async function enrichPlanResources(userId: string, planId: number, expectedRevision: number, entityId?: string) {
  const snapshot = await getPlanSnapshot(userId, planId)
  if (snapshot.row.revision !== expectedRevision) throw createError({ statusCode: 409, statusMessage: '规划已更新，请刷新后补充资源' })
  const entities = planEntities(snapshot.plan)
  let selected = entities.filter(entity => !entityId || entity.entityId === entityId)
  if (entityId && !selected.length) throw createError({ statusCode: 404, statusMessage: '行程地点不存在' })
  if (!entityId) {
    const current = await getPlanResources(userId, planId)
    const pendingIds = new Set(current.resources.filter(resource => resource.status === 'pending').map(resource => resource.entityId))
    selected = selected.filter(entity => pendingIds.has(entity.entityId)).slice(0, 4)
  }
  // At most two concurrent provider lookups per request; a failed image never blocks the itinerary.
  for (let i = 0; i < selected.length; i += 2) await Promise.all(selected.slice(i, i + 2).map(entity => enrichEntity(userId, planId, expectedRevision, entity)))
  return getPlanResources(userId, planId)
}
export async function readPlanResourceImage(userId: string, planId: number, entityId: string, fingerprint?: string) {
  const snapshot = await getPlanSnapshot(userId, planId)
  const entity = planEntities(snapshot.plan).find(value => value.entityId === entityId)
  const row = db.select().from(planResources).where(and(eq(planResources.planId, planId), eq(planResources.entityId, entityId), eq(planResources.userId, userId))).get()
  if (!entity || !row || row.fingerprint !== entity.fingerprint || (fingerprint && fingerprint !== entity.fingerprint) || !row.imageOriginUrl || !row.imageCacheKey) throw createError({ statusCode: 404, statusMessage: '该地点图片暂不可用' })
  return getResourceImageBytes(row.imageOriginUrl, row.imageCacheKey)
}

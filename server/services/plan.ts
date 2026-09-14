import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { PlanSchema, type Plan } from '../../shared/schemas/plan'
import type { PlanPreview, PlanSource } from '../../shared/types'
import { toPlanPreview } from '../../shared/types'
import { diffJson, type DiffEntry } from '../../shared/utils/diff'
import { applyMergePatch } from '../../shared/utils/merge-patch'
import { stableStringify } from '../../shared/utils/json'
import { plans, planVersions } from '../database/schema'
import { db } from '../utils/db'

/** 规划与版本（硬约束 3/5：只追加版本、patch 合并、Undo 不回删） */

export type PlanRow = typeof plans.$inferSelect
export type VersionRow = typeof planVersions.$inferSelect

export function parsePlanJson(input: unknown): Plan {
  const result = PlanSchema.safeParse(input)
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '$'}: ${i.message}`)
      .join('; ')
      .slice(0, 300)
    throw createError({ statusCode: 400, statusMessage: `行程 JSON 校验失败（${detail}）` })
  }
  return result.data
}

export async function listPlans(userId: string) {
  return db
    .select({
      id: plans.id,
      title: plans.title,
      summary: plans.summary,
      coverUrl: plans.coverUrl,
      createdAt: plans.createdAt,
      updatedAt: plans.updatedAt,
    })
    .from(plans)
    .where(eq(plans.userId, userId))
    .orderBy(desc(plans.updatedAt))
}

export async function getPlanRow(userId: string, planId: number): Promise<PlanRow> {
  const row = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.userId, userId)))
    .get()
  if (!row) throw createError({ statusCode: 404, statusMessage: '规划不存在' })
  return row
}

export async function getLatestVersion(planId: number): Promise<VersionRow | undefined> {
  return db
    .select()
    .from(planVersions)
    .where(eq(planVersions.planId, planId))
    .orderBy(desc(planVersions.version))
    .limit(1)
    .get()
}

export interface CommitOptions {
  source: PlanSource
  messageId?: number | null
  parentVersionId?: number | null
  note?: string
}

export async function createPlan(
  userId: string,
  input: unknown,
  opts: { source?: PlanSource; messageId?: number | null; contentMd?: string } = {},
) {
  const plan = parsePlanJson(input)
  const source = opts.source ?? 'ai'
  const [row] = await db
    .insert(plans)
    .values({
      userId,
      title: plan.title,
      summary: plan.summary,
      contentMd: opts.contentMd ?? '',
      planJson: plan,
      coverUrl: plan.cover,
    })
    .returning()
  const [versionRow] = await db
    .insert(planVersions)
    .values({
      planId: row!.id,
      version: 1,
      planJson: plan,
      createdBy: userId,
      source,
      diffJson: null,
      messageId: opts.messageId ?? null,
    })
    .returning()
  return {
    planId: row!.id,
    version: 1,
    versionId: versionRow!.id,
    diff: [] as DiffEntry[],
    preview: toPlanPreview(plan, row!.id, 1, source),
  }
}

export async function commitPlanVersion(
  userId: string,
  planId: number,
  nextInput: unknown,
  opts: CommitOptions,
) {
  const row = await getPlanRow(userId, planId)
  const current = parsePlanJson(row.planJson)
  const next = parsePlanJson(nextInput)
  const latest = await getLatestVersion(planId)
  const version = (latest?.version ?? 0) + 1
  const diff = diffJson(current, next)
  const [versionRow] = await db
    .insert(planVersions)
    .values({
      planId,
      version,
      planJson: next,
      createdBy: userId,
      parentVersionId: opts.parentVersionId ?? latest?.id ?? null,
      source: opts.source,
      diffJson: diff,
      messageId: opts.messageId ?? null,
    })
    .returning()
  await db
    .update(plans)
    .set({
      planJson: next,
      title: next.title,
      summary: next.summary,
      coverUrl: next.cover,
      updatedAt: new Date(),
    })
    .where(eq(plans.id, planId))
  const preview: PlanPreview = toPlanPreview(next, planId, version, opts.source, opts.note)
  return { planId, version, versionId: versionRow!.id, diff, preview, plan: next }
}

/** AI 只允许产出结构 patch，服务端合并后校验（硬约束 3） */
export async function patchPlan(
  userId: string,
  planId: number,
  patch: unknown,
  opts: CommitOptions,
) {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw createError({ statusCode: 400, statusMessage: 'patch 必须是对象（RFC 7396 Merge Patch）' })
  }
  const row = await getPlanRow(userId, planId)
  const current = parsePlanJson(row.planJson)
  const merged = applyMergePatch(current, patch)
  return commitPlanVersion(userId, planId, merged, opts)
}

export async function listVersions(userId: string, planId: number, limit = 50) {
  await getPlanRow(userId, planId)
  return db
    .select({
      id: planVersions.id,
      version: planVersions.version,
      source: planVersions.source,
      parentVersionId: planVersions.parentVersionId,
      messageId: planVersions.messageId,
      createdAt: planVersions.createdAt,
      diffJson: planVersions.diffJson,
    })
    .from(planVersions)
    .where(eq(planVersions.planId, planId))
    .orderBy(desc(planVersions.version))
    .limit(limit)
}

export async function getVersionPlan(userId: string, planId: number, version: number) {
  await getPlanRow(userId, planId)
  const row = await db
    .select()
    .from(planVersions)
    .where(and(eq(planVersions.planId, planId), eq(planVersions.version, version)))
    .get()
  if (!row) throw createError({ statusCode: 404, statusMessage: `版本 v${version} 不存在` })
  return parsePlanJson(row.planJson)
}

/** Undo：基于目标版本新建版本 + 系统消息，永不回删（硬约束 5） */
export async function rollbackToVersion(
  userId: string,
  planId: number,
  version: number,
  opts: { messageId?: number | null } = {},
) {
  await getPlanRow(userId, planId)
  const target = await db
    .select()
    .from(planVersions)
    .where(and(eq(planVersions.planId, planId), eq(planVersions.version, version)))
    .get()
  if (!target) throw createError({ statusCode: 404, statusMessage: `版本 v${version} 不存在` })
  const targetPlan = parsePlanJson(target.planJson)
  return commitPlanVersion(userId, planId, targetPlan, {
    source: 'rollback',
    parentVersionId: target.id,
    messageId: opts.messageId ?? null,
    note: `已回滚到 v${version}（基于该版本内容新建版本，历史保留）`,
  })
}

export async function updatePlanMeta(
  userId: string,
  planId: number,
  meta: { title?: string; summary?: string; contentMd?: string },
) {
  await getPlanRow(userId, planId)
  await db
    .update(plans)
    .set({ ...meta, updatedAt: new Date() })
    .where(eq(plans.id, planId))
  return getPlanRow(userId, planId)
}

/** 手动保存（聊天输入框下方「保存」/ save_plan 工具）：内容未变则不产生新版本 */
export async function savePlanVersion(
  userId: string,
  planId: number,
  opts: { planJson?: unknown; source: PlanSource; messageId?: number | null; note?: string },
) {
  const row = await getPlanRow(userId, planId)
  const current = parsePlanJson(row.planJson)
  const next = opts.planJson === undefined ? current : parsePlanJson(opts.planJson)
  if (stableStringify(current) === stableStringify(next)) {
    const latest = await getLatestVersion(planId)
    const version = latest?.version ?? 1
    return {
      planId,
      version,
      versionId: latest?.id ?? null,
      diff: [] as DiffEntry[],
      preview: toPlanPreview(current, planId, version, opts.source, '内容无变化，未生成新版本'),
      skipped: true,
    }
  }
  const result = await commitPlanVersion(userId, planId, next, {
    source: opts.source,
    messageId: opts.messageId ?? null,
    note: opts.note,
  })
  return { ...result, skipped: false }
}

export async function deletePlan(userId: string, planId: number) {
  await getPlanRow(userId, planId)
  await db.delete(plans).where(eq(plans.id, planId))
  return { ok: true }
}

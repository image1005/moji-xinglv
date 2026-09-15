import { and, desc, eq, inArray, max } from 'drizzle-orm'
import { createError } from 'h3'
import { BudgetSchema, formatPlanIssues, PlanSchema, type Budget, type Plan } from '../../shared/schemas/plan'
import type { PlanSource } from '../../shared/types'
import { toPlanPreview } from '../../shared/types'
import { diffJson, type DiffEntry } from '../../shared/utils/diff'
import { applyMergePatch } from '../../shared/utils/merge-patch'
import { stableStringify } from '../../shared/utils/json'
import { applyPlanEditOps, PlanEditError, type PlanEditOp } from '../../shared/utils/plan-edits'
import { plans, planVersions } from '../database/schema'
import { db } from '../utils/db'

export type PlanRow = typeof plans.$inferSelect
export type VersionRow = typeof planVersions.$inferSelect
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Reader = typeof db | Transaction

export function parsePlanJson(input: unknown): Plan {
  const result = PlanSchema.safeParse(input)
  if (!result.success) {
    const detail = formatPlanIssues(result.error.issues).slice(0, 500)
    throw createError({ statusCode: 400, statusMessage: `行程 JSON 校验失败（${detail}）` })
  }
  return result.data
}

function readPlan(conn: Reader, userId: string, planId: number): PlanRow {
  const row = conn.select().from(plans)
    .where(and(eq(plans.id, planId), eq(plans.userId, userId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: '规划不存在' })
  return row
}

function readLatestVersion(conn: Reader, planId: number): VersionRow | undefined {
  return conn.select().from(planVersions).where(eq(planVersions.planId, planId))
    .orderBy(desc(planVersions.version)).limit(1).get()
}

/** 当前版本 = plans.current_version_id 指针；历史数据为空时回退到最新版本。 */
function readCurrentVersion(conn: Reader, row: PlanRow): VersionRow | undefined {
  if (row.currentVersionId) {
    const target = conn.select().from(planVersions)
      .where(and(eq(planVersions.id, row.currentVersionId), eq(planVersions.planId, row.id))).get()
    if (target) return target
  }
  return readLatestVersion(conn, row.id)
}

function readSnapshot(conn: Reader, userId: string, planId: number) {
  const row = readPlan(conn, userId, planId)
  return {
    row,
    plan: parsePlanJson(row.planJson),
    latest: readLatestVersion(conn, planId),
    current: readCurrentVersion(conn, row),
  }
}

type Snapshot = ReturnType<typeof readSnapshot>

function assertVersion(snapshot: Snapshot, expectedVersion?: number) {
  const currentVersion = snapshot.current?.version ?? 0
  if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
    throw createError({
      statusCode: 409,
      statusMessage: '规划已更新，请刷新后重试',
      data: { currentVersion },
    })
  }
}

export async function listPlans(userId: string) {
  const rows = await db.select({
    id: plans.id,
    title: plans.title,
    summary: plans.summary,
    coverUrl: plans.coverUrl,
    createdAt: plans.createdAt,
    updatedAt: plans.updatedAt,
    version: planVersions.version,
  }).from(plans)
    .leftJoin(planVersions, eq(plans.currentVersionId, planVersions.id))
    .where(eq(plans.userId, userId))
    .orderBy(desc(plans.updatedAt))
  // 未回填指针的历史规划按最新版本展示。
  const missing = rows.filter((row) => row.version === null).map((row) => row.id)
  const fallback = missing.length
    ? await db.select({ planId: planVersions.planId, version: max(planVersions.version) })
      .from(planVersions).where(inArray(planVersions.planId, missing)).groupBy(planVersions.planId)
    : []
  const versions = new Map(fallback.map((row) => [row.planId, Number(row.version ?? 1)]))
  return rows.map((row) => ({ ...row, version: row.version ?? versions.get(row.id) ?? 1 }))
}

export async function getPlanRow(userId: string, planId: number): Promise<PlanRow> {
  return readPlan(db, userId, planId)
}

/** 调用者须已校验规划归属；需要 JSON 与版本一致时使用 getPlanSnapshot。 */
export async function getLatestVersion(planId: number): Promise<VersionRow | undefined> {
  return readLatestVersion(db, planId)
}

export async function getPlanSnapshot(userId: string, planId: number) {
  return db.transaction((tx) => readSnapshot(tx, userId, planId))
}

export interface CommitOptions {
  source: PlanSource
  messageId?: number | null
  parentVersionId?: number | null
  expectedVersion?: number
  note?: string
}

/** Bun SQLite 事务回调必须同步，全部查询显式执行 .get/.run。 */
function commitVersion(tx: Transaction, snapshot: Snapshot, next: Plan, opts: CommitOptions) {
  assertVersion(snapshot, opts.expectedVersion)
  const { row, plan: current, latest } = snapshot
  if (opts.parentVersionId !== undefined && opts.parentVersionId !== null) {
    const parent = tx.select({ id: planVersions.id }).from(planVersions)
      .where(and(eq(planVersions.id, opts.parentVersionId), eq(planVersions.planId, row.id))).get()
    if (!parent) throw createError({ statusCode: 404, statusMessage: '父版本不存在' })
  }
  const version = (latest?.version ?? 0) + 1
  const diff = diffJson(current, next)
  const versionRow = tx.insert(planVersions).values({
    planId: row.id,
    version,
    planJson: next,
    createdBy: row.userId,
    parentVersionId: opts.parentVersionId ?? snapshot.current?.id ?? null,
    source: opts.source,
    diffJson: diff,
    messageId: opts.messageId ?? null,
  }).returning().get()
  tx.update(plans).set({
    planJson: next,
    title: next.title,
    summary: next.summary,
    coverUrl: next.cover,
    currentVersionId: versionRow.id,
    updatedAt: new Date(),
  }).where(and(eq(plans.id, row.id), eq(plans.userId, row.userId))).run()
  return {
    planId: row.id,
    version,
    versionId: versionRow.id,
    diff,
    preview: toPlanPreview(next, row.id, version, opts.source, opts.note),
    plan: next,
  }
}

/** 一轮 AI 对话只保留一个版本：同 messageId 且仍是当前版本时原地更新，否则追加。 */
function commitAiTurn(
  tx: Transaction,
  snapshot: Snapshot,
  next: Plan,
  opts: { messageId?: number | null; note?: string },
) {
  const { row, plan: current, current: currentVersion } = snapshot
  const messageId = opts.messageId ?? null
  const existing = messageId === null
    ? undefined
    : tx.select().from(planVersions)
      .where(and(eq(planVersions.planId, row.id), eq(planVersions.messageId, messageId), eq(planVersions.source, 'ai')))
      .orderBy(desc(planVersions.version)).limit(1).get()
  if (existing && currentVersion?.id === existing.id) {
    const parent = existing.parentVersionId === null
      ? undefined
      : tx.select().from(planVersions)
        .where(and(eq(planVersions.id, existing.parentVersionId), eq(planVersions.planId, row.id))).get()
    const diff = diffJson(parent?.planJson ?? current, next)
    tx.update(planVersions).set({ planJson: next, diffJson: diff }).where(eq(planVersions.id, existing.id)).run()
    tx.update(plans).set({
      planJson: next,
      title: next.title,
      summary: next.summary,
      coverUrl: next.cover,
      updatedAt: new Date(),
    }).where(and(eq(plans.id, row.id), eq(plans.userId, row.userId))).run()
    return {
      planId: row.id,
      version: existing.version,
      versionId: existing.id,
      diff,
      preview: toPlanPreview(next, row.id, existing.version, 'ai', opts.note),
      plan: next,
    }
  }
  return commitVersion(tx, snapshot, next, {
    source: 'ai',
    messageId,
    parentVersionId: snapshot.current?.id ?? null,
    note: opts.note,
  })
}

export interface ApplyEditsOptions {
  messageId?: number | null
  note?: string
  expectedVersion?: number
}

/** 原子编辑：读、顺序应用、校验与写入同一事务；一轮对话只保留一个版本。 */
export async function applyPlanEdits(
  userId: string,
  planId: number,
  edits: readonly PlanEditOp[],
  opts: ApplyEditsOptions = {},
) {
  return db.transaction((tx) => {
    const snapshot = readSnapshot(tx, userId, planId)
    assertVersion(snapshot, opts.expectedVersion)
    let next: Plan
    try {
      next = parsePlanJson(applyPlanEditOps(snapshot.plan, edits))
    } catch (error) {
      if (error instanceof PlanEditError) throw createError({ statusCode: 400, statusMessage: error.message })
      throw error
    }
    if (stableStringify(snapshot.plan) === stableStringify(next)) {
      const version = snapshot.current?.version ?? 0
      return {
        planId,
        version,
        versionId: snapshot.current?.id ?? null,
        diff: [] as DiffEntry[],
        preview: toPlanPreview(next, planId, version, 'ai', opts.note ?? '内容无变化，未生成新版本'),
        plan: next,
        skipped: true as const,
      }
    }
    return { ...commitAiTurn(tx, snapshot, next, opts), skipped: false as const }
  }, { behavior: 'immediate' })
}

export async function createPlan(
  userId: string,
  input: unknown,
  opts: { source?: PlanSource; messageId?: number | null; contentMd?: string } = {},
) {
  const plan = parsePlanJson(input)
  const source = opts.source ?? 'ai'
  return db.transaction((tx) => {
    const row = tx.insert(plans).values({
      userId,
      title: plan.title,
      summary: plan.summary,
      contentMd: opts.contentMd ?? '',
      planJson: plan,
      coverUrl: plan.cover,
    }).returning().get()
    const versionRow = tx.insert(planVersions).values({
      planId: row.id,
      version: 1,
      planJson: plan,
      createdBy: userId,
      source,
      diffJson: null,
      messageId: opts.messageId ?? null,
    }).returning().get()
    tx.update(plans).set({ currentVersionId: versionRow.id }).where(eq(plans.id, row.id)).run()
    return {
      planId: row.id,
      version: 1,
      versionId: versionRow.id,
      diff: [] as DiffEntry[],
      preview: toPlanPreview(plan, row.id, 1, source),
    }
  }, { behavior: 'immediate' })
}

export async function commitPlanVersion(
  userId: string,
  planId: number,
  nextInput: unknown,
  opts: CommitOptions,
) {
  return db.transaction((tx) => {
    const snapshot = readSnapshot(tx, userId, planId)
    return commitVersion(tx, snapshot, parsePlanJson(nextInput), opts)
  }, { behavior: 'immediate' })
}

/** 读、合并、版本比较与写入在同一事务内，防止数组 patch 覆盖并发修改。 */
export async function patchPlan(userId: string, planId: number, patch: unknown, opts: CommitOptions) {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw createError({ statusCode: 400, statusMessage: 'patch 必须是对象（RFC 7396 Merge Patch）' })
  }
  return db.transaction((tx) => {
    const snapshot = readSnapshot(tx, userId, planId)
    assertVersion(snapshot, opts.expectedVersion)
    const next = parsePlanJson(applyMergePatch(snapshot.plan, patch))
    return commitVersion(tx, snapshot, next, {
      ...opts,
      expectedVersion: snapshot.current?.version ?? 0,
    })
  }, { behavior: 'immediate' })
}

export async function listVersions(userId: string, planId: number, limit = 50) {
  await getPlanRow(userId, planId)
  return db.select({
    id: planVersions.id,
    version: planVersions.version,
    source: planVersions.source,
    parentVersionId: planVersions.parentVersionId,
    messageId: planVersions.messageId,
    createdAt: planVersions.createdAt,
    diffJson: planVersions.diffJson,
  }).from(planVersions).where(eq(planVersions.planId, planId))
    .orderBy(desc(planVersions.version)).limit(limit)
}

export async function getVersionPlan(userId: string, planId: number, version: number) {
  await getPlanRow(userId, planId)
  const row = db.select().from(planVersions)
    .where(and(eq(planVersions.planId, planId), eq(planVersions.version, version))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: `版本 v${version} 不存在` })
  return parsePlanJson(row.planJson)
}

/** 切换当前版本到指定版本：只移动指针，不新建版本，历史完整保留。 */
export async function switchToVersion(
  userId: string,
  planId: number,
  version: number,
  opts: { messageId?: number | null; expectedVersion?: number } = {},
) {
  return db.transaction((tx) => {
    const snapshot = readSnapshot(tx, userId, planId)
    assertVersion(snapshot, opts.expectedVersion)
    const target = tx.select().from(planVersions)
      .where(and(eq(planVersions.planId, planId), eq(planVersions.version, version))).get()
    if (!target) throw createError({ statusCode: 404, statusMessage: `版本 v${version} 不存在` })
    const next = parsePlanJson(target.planJson)
    tx.update(plans).set({
      planJson: next,
      title: next.title,
      summary: next.summary,
      coverUrl: next.cover,
      currentVersionId: target.id,
      updatedAt: new Date(),
    }).where(and(eq(plans.id, snapshot.row.id), eq(plans.userId, snapshot.row.userId))).run()
    return {
      planId,
      version: target.version,
      versionId: target.id,
      switched: true as const,
      preview: toPlanPreview(next, planId, target.version, 'rollback', `已切换到 v${version}，历史版本保留`),
      plan: next,
    }
  }, { behavior: 'immediate' })
}

export async function updatePlanMeta(
  userId: string,
  planId: number,
  meta: {
    title?: string
    summary?: string
    cover?: string
    tags?: string[]
    tips?: string[]
    budget?: Budget
    contentMd?: string
    expectedVersion?: number
  },
) {
  return db.transaction((tx) => {
    const snapshot = readSnapshot(tx, userId, planId)
    assertVersion(snapshot, meta.expectedVersion)
    const next = parsePlanJson({
      ...snapshot.plan,
      ...(meta.title !== undefined ? { title: meta.title } : {}),
      ...(meta.summary !== undefined ? { summary: meta.summary } : {}),
      ...(meta.cover !== undefined ? { cover: meta.cover } : {}),
      ...(meta.tags !== undefined ? { tags: meta.tags } : {}),
      ...(meta.tips !== undefined ? { tips: meta.tips } : {}),
      ...(meta.budget !== undefined ? { budget: BudgetSchema.parse(meta.budget) } : {}),
    })
    let version = snapshot.current?.version ?? 0
    if (stableStringify(next) !== stableStringify(snapshot.plan)) {
      version = commitVersion(tx, snapshot, next, {
        source: 'user', expectedVersion: version, note: '修改规划信息',
      }).version
    }
    if (meta.contentMd !== undefined) {
      tx.update(plans).set({ contentMd: meta.contentMd, updatedAt: new Date() })
        .where(and(eq(plans.id, planId), eq(plans.userId, userId))).run()
    }
    return { ...readPlan(tx, userId, planId), version }
  }, { behavior: 'immediate' })
}

/** 内容未变不追加版本，但仍先检查客户端版本。 */
export async function savePlanVersion(
  userId: string,
  planId: number,
  opts: { planJson?: unknown; source: PlanSource; messageId?: number | null; note?: string; expectedVersion?: number },
) {
  return db.transaction((tx) => {
    const snapshot = readSnapshot(tx, userId, planId)
    assertVersion(snapshot, opts.expectedVersion)
    const next = opts.planJson === undefined ? snapshot.plan : parsePlanJson(opts.planJson)
    if (stableStringify(snapshot.plan) === stableStringify(next)) {
      const version = snapshot.current?.version ?? 0
      return {
        planId,
        version,
        versionId: snapshot.current?.id ?? null,
        diff: [] as DiffEntry[],
        preview: toPlanPreview(snapshot.plan, planId, version, opts.source, '内容无变化，未生成新版本'),
        skipped: true,
      }
    }
    return { ...commitVersion(tx, snapshot, next, opts), skipped: false }
  }, { behavior: 'immediate' })
}

export async function deletePlan(userId: string, planId: number) {
  const row = db.delete(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId)))
    .returning({ id: plans.id }).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: '规划不存在' })
  return { ok: true }
}

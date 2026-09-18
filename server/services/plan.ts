import { and, desc, eq, inArray, lt, max, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { BudgetSchema, formatPlanIssues, PlanSchema, type Budget, type Plan } from '../../shared/schemas/plan'
import type { PageOptions, PlanPreview, PlanSource } from '../../shared/types'
import { toPlanPreview } from '../../shared/types'
import { diffJson, type DiffEntry } from '../../shared/utils/diff'
import { applyMergePatch } from '../../shared/utils/merge-patch'
import { stableStringify } from '../../shared/utils/json'
import { applyPlanEditOps, PlanEditError, type PlanEditOp } from '../../shared/utils/plan-edits'
import { conversations, messages, plans, planVersions } from '../database/schema'
import { db } from '../utils/db'
import { finishPage, readPage } from './pagination'
import { ensurePlanEntityIds } from '../../shared/utils/plan-entities'

export type PlanRow = typeof plans.$inferSelect
type VersionRow = typeof planVersions.$inferSelect
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Reader = typeof db | Transaction

export function parsePlanJson(input: unknown, previous?: Plan): Plan {
  const result = PlanSchema.safeParse(input)
  if (!result.success) {
    const detail = formatPlanIssues(result.error.issues).slice(0, 500)
    throw createError({ statusCode: 400, statusMessage: `行程 JSON 校验失败（${detail}）` })
  }
  return ensurePlanEntityIds(result.data, previous)
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

function assertVersion(snapshot: Snapshot, expectedVersion?: number, expectedRevision?: number) {
  const currentVersion = snapshot.current?.version ?? 0
  if ((expectedVersion !== undefined && expectedVersion !== currentVersion)
    || (expectedRevision !== undefined && expectedRevision !== snapshot.row.revision)) {
    throw createError({
      statusCode: 409,
      statusMessage: '规划已更新，请刷新后重试',
      data: { currentVersion, currentRevision: snapshot.row.revision },
    })
  }
}

async function readPlanList(userId: string, page?: ReturnType<typeof readPage>, filter: { q?: string; sort?: 'created' | 'updated' } = {}) {
  const cursor = page?.cursor
  const sortColumn = filter.sort === 'created' ? plans.createdAt : plans.updatedAt
  const keyword = filter.q?.trim().toLocaleLowerCase()
  const query = db.select({
    id: plans.id,
    title: plans.title,
    summary: plans.summary,
    coverUrl: plans.coverUrl,
    createdAt: plans.createdAt,
    updatedAt: plans.updatedAt,
    revision: plans.revision,
    version: planVersions.version,
  }).from(plans)
    .leftJoin(planVersions, eq(plans.currentVersionId, planVersions.id))
    .where(and(eq(plans.userId, userId), cursor ? or(
      lt(sortColumn, new Date(cursor.sort)), and(eq(sortColumn, new Date(cursor.sort)), lt(plans.id, cursor.id)),
    ) : undefined, keyword ? or(
      sql`instr(lower(${plans.title}), ${keyword}) > 0`, sql`instr(lower(${plans.summary}), ${keyword}) > 0`,
      inArray(plans.id, db.select({ id: conversations.planId }).from(conversations).where(and(eq(conversations.userId, userId), sql`instr(lower(${conversations.title}), ${keyword}) > 0`))),
    ) : undefined))
    .orderBy(desc(sortColumn), desc(plans.id)).$dynamic()
  const rows = await (page ? query.limit(page.limit + 1) : query)
  // 未回填指针的历史规划按最新版本展示。
  const missing = rows.filter((row) => row.version === null).map((row) => row.id)
  const fallback = missing.length
    ? await db.select({ planId: planVersions.planId, version: max(planVersions.version) })
      .from(planVersions).where(inArray(planVersions.planId, missing)).groupBy(planVersions.planId)
    : []
  const versions = new Map(fallback.map((row) => [row.planId, Number(row.version ?? 1)]))
  return rows.map((row) => ({ ...row, version: row.version ?? versions.get(row.id) ?? 1 }))
}

export async function listPlans(userId: string) { return readPlanList(userId) }

export async function listPlansPage(userId: string, options: PageOptions & { q?: string; sort?: 'created' | 'updated' } = {}) {
  const scope = `plans:${userId}:${options.sort ?? 'updated'}:${options.q?.trim().toLocaleLowerCase() ?? ''}`
  const page = readPage(options, scope)
  return finishPage(await readPlanList(userId, page, options), page, (row) => ({ sort: (options.sort === 'created' ? row.createdAt : row.updatedAt).getTime(), id: row.id }))
}

export async function getPlanRow(userId: string, planId: number): Promise<PlanRow> {
  return readPlan(db, userId, planId)
}

export async function getPlanSnapshot(userId: string, planId: number) {
  return db.transaction((tx) => readSnapshot(tx, userId, planId))
}

export interface CommitOptions {
  source: PlanSource
  messageId?: number | null
  parentVersionId?: number | null
  expectedVersion?: number
  expectedRevision?: number
  conversationId?: number
  note?: string
}

/** Bun SQLite 事务回调必须同步，全部查询显式执行 .get/.run。 */
function commitVersion(tx: Transaction, snapshot: Snapshot, next: Plan, opts: CommitOptions) {
  assertVersion(snapshot, opts.expectedVersion, opts.expectedRevision)
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
    revision: row.revision + 1,
    updatedAt: new Date(),
  }).where(and(eq(plans.id, row.id), eq(plans.userId, row.userId))).run()
  return {
    planId: row.id,
    version,
    revision: row.revision + 1,
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
  opts: CommitOptions,
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
      revision: row.revision + 1,
      updatedAt: new Date(),
    }).where(and(eq(plans.id, row.id), eq(plans.userId, row.userId))).run()
    return {
      planId: row.id,
      version: existing.version,
      revision: row.revision + 1,
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
  expectedRevision?: number
}

function assertMessageScope(tx: Transaction, row: PlanRow, opts: CommitOptions) {
  if (opts.conversationId !== undefined) {
    const conversation = tx.select({ id: conversations.id }).from(conversations).where(and(
      eq(conversations.id, opts.conversationId), eq(conversations.planId, row.id), eq(conversations.userId, row.userId),
    )).get()
    if (!conversation) throw createError({ statusCode: 404, statusMessage: '会话不属于当前规划' })
  }
  if (opts.source === 'ai' && opts.messageId != null) {
    const message = tx.select({ id: messages.id }).from(messages).innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(and(eq(messages.id, opts.messageId), eq(messages.role, 'assistant'), eq(conversations.planId, row.id), eq(conversations.userId, row.userId))).get()
    if (!message) throw createError({ statusCode: 404, statusMessage: '助手消息不属于当前规划' })
  }
}

/** 两种 AI 编辑共用无变化检查、同轮合并和事务内预览持久化。 */
function commitMutation(tx: Transaction, snapshot: Snapshot, next: Plan, opts: CommitOptions) {
  assertVersion(snapshot, opts.expectedVersion, opts.expectedRevision)
  assertMessageScope(tx, snapshot.row, opts)
  if (opts.source === 'ai') {
    // Model guesses are never location evidence. Existing user/provider-confirmed points may
    // be retained for the same place; new locations stay null until the place service resolves them.
    const locationKey = (city: string, spot: Plan['days'][number]['spots'][number]) => stableStringify([city.trim(), spot.name.trim(), spot.address.trim(), spot.lng, spot.lat])
    const known = new Set(snapshot.plan.days.flatMap(day => day.spots.filter(spot => spot.lng !== null && spot.lat !== null).map(spot => locationKey(day.city, spot))))
    for (const day of next.days) for (const spot of day.spots) {
      if (spot.lng !== null && spot.lat !== null && !known.has(locationKey(day.city, spot))) {
        throw createError({ statusCode: 400, statusMessage: 'AI 不可提交未经核实的坐标；新地点或地点变更请将 lng/lat 同时设为 null，由地点服务定位，用户仍可手工补全' })
      }
    }
  }
  if (opts.parentVersionId != null) {
    const parent = tx.select({ id: planVersions.id }).from(planVersions)
      .where(and(eq(planVersions.id, opts.parentVersionId), eq(planVersions.planId, snapshot.row.id))).get()
    if (!parent) throw createError({ statusCode: 404, statusMessage: '父版本不存在' })
  }
  const unchanged = stableStringify(snapshot.plan) === stableStringify(next)
  const version = snapshot.current?.version ?? 0
  const result = unchanged ? {
    planId: snapshot.row.id, version, revision: snapshot.row.revision, versionId: snapshot.current?.id ?? null,
    diff: [] as DiffEntry[], preview: toPlanPreview(next, snapshot.row.id, version, opts.source, opts.note ?? '内容无变化，未生成新版本'),
    plan: next, skipped: true,
  } : { ...(opts.source === 'ai' ? commitAiTurn(tx, snapshot, next, opts) : commitVersion(tx, snapshot, next, opts)), skipped: false }
  if (opts.source === 'ai' && opts.messageId != null) {
    tx.update(messages).set({ previewJson: result.preview, planVersionId: result.versionId }).where(eq(messages.id, opts.messageId)).run()
  }
  return result
}

function appendSystemMessage(tx: Transaction, conversationId: number | undefined,
  result: { preview: PlanPreview; versionId: number | null }, content: string,
) {
  if (conversationId === undefined) return
  tx.insert(messages).values({ conversationId, role: 'system', content, previewJson: result.preview, planVersionId: result.versionId }).run()
  tx.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId)).run()
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
    assertVersion(snapshot, opts.expectedVersion, opts.expectedRevision)
    let next: Plan
    try {
      next = parsePlanJson(applyPlanEditOps(snapshot.plan, edits), snapshot.plan)
    } catch (error) {
      if (error instanceof PlanEditError) throw createError({ statusCode: 400, statusMessage: error.message })
      throw error
    }
    return commitMutation(tx, snapshot, next, { ...opts, source: 'ai' })
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
      revision: row.revision,
      plan,
      diff: [] as DiffEntry[],
      preview: toPlanPreview(plan, row.id, 1, source),
    }
  }, { behavior: 'immediate' })
}

/** 读、合并、版本比较与写入在同一事务内，防止数组 patch 覆盖并发修改。 */
export async function patchPlan(userId: string, planId: number, patch: unknown, opts: CommitOptions) {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw createError({ statusCode: 400, statusMessage: 'patch 必须是对象（RFC 7396 Merge Patch）' })
  }
  return db.transaction((tx) => {
    const snapshot = readSnapshot(tx, userId, planId)
    assertVersion(snapshot, opts.expectedVersion, opts.expectedRevision)
    const next = parsePlanJson(applyMergePatch(snapshot.plan, patch), snapshot.plan)
    return commitMutation(tx, snapshot, next, opts)
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

export async function listVersionsPage(userId: string, planId: number, options: PageOptions = {}) {
  await getPlanRow(userId, planId)
  const page = readPage(options, `versions:${userId}:${planId}`)
  const rows = await db.select({
    id: planVersions.id, version: planVersions.version, source: planVersions.source,
    parentVersionId: planVersions.parentVersionId, messageId: planVersions.messageId,
    createdAt: planVersions.createdAt, diffJson: planVersions.diffJson,
  }).from(planVersions).where(and(eq(planVersions.planId, planId), page.cursor ? lt(planVersions.version, page.cursor.sort) : undefined))
    .orderBy(desc(planVersions.version)).limit(page.limit + 1)
  return finishPage(rows, page, (row) => ({ sort: row.version, id: row.id }))
}

export async function getVersionPlan(userId: string, planId: number, version: number) {
  await getPlanRow(userId, planId)
  const row = db.select({ planJson: planVersions.planJson }).from(planVersions)
    .where(and(eq(planVersions.planId, planId), eq(planVersions.version, version))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: `版本 v${version} 不存在` })
  return parsePlanJson(row.planJson)
}

/** 切换当前版本到指定版本：只移动指针，不新建版本，历史完整保留。 */
export async function switchToVersion(
  userId: string,
  planId: number,
  version: number,
  opts: { messageId?: number | null; expectedVersion?: number; expectedRevision?: number; conversationId?: number } = {},
) {
  return db.transaction((tx) => {
    const snapshot = readSnapshot(tx, userId, planId)
    assertVersion(snapshot, opts.expectedVersion, opts.expectedRevision)
    assertMessageScope(tx, snapshot.row, { ...opts, source: 'rollback' })
    const target = tx.select().from(planVersions)
      .where(and(eq(planVersions.planId, planId), eq(planVersions.version, version))).get()
    if (!target) throw createError({ statusCode: 404, statusMessage: `版本 v${version} 不存在` })
    const next = parsePlanJson(target.planJson)
    const changed = snapshot.row.currentVersionId !== target.id || stableStringify(snapshot.plan) !== stableStringify(next)
    const revision = snapshot.row.revision + Number(changed)
    if (changed) tx.update(plans).set({
      planJson: next,
      title: next.title,
      summary: next.summary,
      coverUrl: next.cover,
      currentVersionId: target.id,
      revision,
      updatedAt: new Date(),
    }).where(and(eq(plans.id, snapshot.row.id), eq(plans.userId, snapshot.row.userId))).run()
    const result = {
      planId,
      version: target.version,
      revision,
      versionId: target.id,
      switched: true as const,
      skipped: !changed,
      preview: toPlanPreview(next, planId, target.version, 'rollback', `已切换到 v${version}，历史版本保留`),
      plan: next,
    }
    appendSystemMessage(tx, opts.conversationId, result, `已切换到 v${result.version}（不新建版本，历史版本保留）`)
    return result
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
    expectedRevision?: number
  },
) {
  return db.transaction((tx) => {
    const snapshot = readSnapshot(tx, userId, planId)
    assertVersion(snapshot, meta.expectedVersion, meta.expectedRevision)
    const next = parsePlanJson({
      ...snapshot.plan,
      ...(meta.title !== undefined ? { title: meta.title } : {}),
      ...(meta.summary !== undefined ? { summary: meta.summary } : {}),
      ...(meta.cover !== undefined ? { cover: meta.cover } : {}),
      ...(meta.tags !== undefined ? { tags: meta.tags } : {}),
      ...(meta.tips !== undefined ? { tips: meta.tips } : {}),
      ...(meta.budget !== undefined ? { budget: BudgetSchema.parse(meta.budget) } : {}),
    })
    const result = commitMutation(tx, snapshot, next, { source: 'user', expectedVersion: meta.expectedVersion, expectedRevision: meta.expectedRevision, note: '修改规划信息' })
    const contentChanged = meta.contentMd !== undefined && meta.contentMd !== snapshot.row.contentMd
    if (contentChanged) {
      tx.update(plans).set({ contentMd: meta.contentMd, revision: result.revision + Number(result.skipped), updatedAt: new Date() })
        .where(and(eq(plans.id, planId), eq(plans.userId, userId))).run()
    }
    return { ...readPlan(tx, userId, planId), version: result.version, plan: next, skipped: result.skipped && !contentChanged }
  }, { behavior: 'immediate' })
}

/** 内容未变不追加版本，但仍先检查客户端版本。 */
export async function savePlanVersion(
  userId: string,
  planId: number,
  opts: CommitOptions & { planJson?: unknown },
) {
  return db.transaction((tx) => {
    const snapshot = readSnapshot(tx, userId, planId)
    assertVersion(snapshot, opts.expectedVersion, opts.expectedRevision)
    const next = opts.planJson === undefined ? snapshot.plan : parsePlanJson(opts.planJson, snapshot.plan)
    const result = commitMutation(tx, snapshot, next, opts)
    appendSystemMessage(tx, opts.conversationId, result, result.skipped ? '内容无变化，未生成新版本' : `已保存为 v${result.version}`)
    return result
  }, { behavior: 'immediate' })
}

export async function deletePlan(userId: string, planId: number) {
  const row = db.delete(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId)))
    .returning({ id: plans.id }).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: '规划不存在' })
  return { ok: true }
}

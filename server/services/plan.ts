import { and, desc, eq, inArray, lt, max, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { BudgetSchema, formatPlanIssues, PlanSchema, type Budget, type Plan } from '../../shared/schemas/plan'
import type { PageOptions, PlanPreview, PlanSource } from '../../shared/types'
import { toPlanPreview } from '../../shared/types'
import { diffJson, type DiffEntry } from '../../shared/utils/diff'
import { applyMergePatch } from '../../shared/utils/merge-patch'
import { stableStringify } from '../../shared/utils/json'
import { applyPlanEditOps, PlanEditError, type PlanEditOp } from '../../shared/utils/plan-edits'
import { chatRuns, conversations, messages, plans, planRunDrafts, planVersions } from '../database/schema'
import { db } from '../utils/db'
import { finishPage, readPage } from './pagination'
import { ensurePlanEntityIds } from '../../shared/utils/plan-entities'
import { fallbackVersionName, scheduleVersionName } from './version-names'

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

function readSnapshot(conn: Reader, userId: string, planId: number, messageId?: number | null) {
  const row = readPlan(conn, userId, planId)
  const snapshot = {
    row,
    plan: parsePlanJson(row.planJson),
    latest: readLatestVersion(conn, planId),
    current: readCurrentVersion(conn, row),
  }
  if (messageId != null) {
    assertMessageScope(conn, row, { source: 'ai', messageId })
    const run = conn.select().from(chatRuns).where(and(eq(chatRuns.assistantMessageId, messageId), eq(chatRuns.planId, planId), eq(chatRuns.userId, userId))).get()
    if (!run || run.status !== 'running') throw createError({ statusCode: 409, statusMessage: '生成任务已结束或不存在，请开始新一轮' })
    const draft = conn.select().from(planRunDrafts).where(eq(planRunDrafts.runId, run.id)).get()
    if (draft) {
      assertDraftBaseline(snapshot, draft)
      snapshot.plan = parsePlanJson(draft.planJson)
    }
  }
  return snapshot
}

type Snapshot = ReturnType<typeof readSnapshot>
type DraftRow = typeof planRunDrafts.$inferSelect

function assertDraftBaseline(snapshot: Snapshot, draft: DraftRow) {
  if (draft.status !== 'active' || draft.revision !== snapshot.row.revision || draft.baseVersionId !== (snapshot.current?.id ?? null)) {
    throw createError({ statusCode: 409, statusMessage: '规划已更新，当前生成草稿已保留，请结束本轮后比较并恢复草稿', data: { draftId: draft.id, currentRevision: snapshot.row.revision } })
  }
}

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

export async function getPlanSnapshot(userId: string, planId: number, messageId?: number) {
  return db.transaction((tx) => readSnapshot(tx, userId, planId, messageId))
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
    name: fallbackVersionName(next, current),
    nameSource: 'fallback',
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

/** Each running assistant owns one durable checkpoint; completed history is immutable. */
function commitAiTurn(
  tx: Transaction,
  snapshot: Snapshot,
  next: Plan,
  opts: CommitOptions,
) {
  if (opts.messageId == null) return commitVersion(tx, snapshot, next, opts)
  const { row, current } = snapshot
  const run = tx.select().from(chatRuns).where(and(eq(chatRuns.assistantMessageId, opts.messageId), eq(chatRuns.planId, row.id), eq(chatRuns.userId, row.userId))).get()
  if (!run || run.status !== 'running') throw createError({ statusCode: 409, statusMessage: '生成任务已结束，请开始新一轮' })
  const existing = tx.select().from(planRunDrafts).where(eq(planRunDrafts.runId, run.id)).get()
  if (existing) assertDraftBaseline(snapshot, existing)
  const revision = row.revision + 1
  const draft = existing
    ? tx.update(planRunDrafts).set({ planJson: next, revision, updatedAt: new Date() }).where(eq(planRunDrafts.id, existing.id)).returning().get()!
    : tx.insert(planRunDrafts).values({ runId: run.id, planId: row.id, messageId: opts.messageId, baseVersionId: current?.id ?? null, baseRevision: row.revision, revision, planJson: next }).returning().get()
  tx.update(plans).set({ revision }).where(eq(plans.id, row.id)).run()
  const version = current?.version ?? 0
  return { planId: row.id, version, revision, versionId: null, draftId: draft.id,
    diff: diffJson(snapshot.plan, next), plan: next,
    preview: { ...toPlanPreview(next, row.id, version, 'ai', opts.note ?? '生成中，尚未提交正式版本'), draftId: draft.id, status: 'draft' as const } }
}

export interface ApplyEditsOptions {
  messageId?: number | null
  note?: string
  expectedVersion?: number
  expectedRevision?: number
}

function assertMessageScope(tx: Reader, row: PlanRow, opts: CommitOptions) {
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
  const draft = opts.source === 'ai' && opts.messageId != null
    ? tx.select().from(planRunDrafts).where(and(eq(planRunDrafts.planId, snapshot.row.id), eq(planRunDrafts.messageId, opts.messageId), eq(planRunDrafts.status, 'active'))).get() : undefined
  const result = unchanged ? {
    planId: snapshot.row.id, version, revision: snapshot.row.revision, versionId: snapshot.current?.id ?? null,
    diff: [] as DiffEntry[], preview: toPlanPreview(next, snapshot.row.id, version, opts.source, opts.note ?? '内容无变化，未生成新版本'),
    plan: next, skipped: true,
    ...(draft ? { versionId: null, draftId: draft.id, preview: { ...toPlanPreview(next, snapshot.row.id, version, 'ai', '草稿内容无变化'), draftId: draft.id, status: 'draft' as const } } : {}),
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
  const result = db.transaction((tx) => {
    const snapshot = readSnapshot(tx, userId, planId, opts.messageId)
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
  if (!result.skipped && result.versionId) scheduleVersionName(userId, planId, result.versionId)
  return result
}

export async function createPlan(
  userId: string,
  input: unknown,
  opts: { source?: PlanSource; messageId?: number | null; contentMd?: string } = {},
) {
  const plan = parsePlanJson(input)
  const source = opts.source ?? 'ai'
  const result = db.transaction((tx) => {
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
      name: fallbackVersionName(plan), nameSource: 'fallback',
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
  scheduleVersionName(userId, result.planId, result.versionId)
  return result
}

/** 读、合并、版本比较与写入在同一事务内，防止数组 patch 覆盖并发修改。 */
export async function patchPlan(userId: string, planId: number, patch: unknown, opts: CommitOptions) {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw createError({ statusCode: 400, statusMessage: 'patch 必须是对象（RFC 7396 Merge Patch）' })
  }
  const result = db.transaction((tx) => {
    const snapshot = readSnapshot(tx, userId, planId, opts.source === 'ai' ? opts.messageId : undefined)
    assertVersion(snapshot, opts.expectedVersion, opts.expectedRevision)
    const next = parsePlanJson(applyMergePatch(snapshot.plan, patch), snapshot.plan)
    return commitMutation(tx, snapshot, next, opts)
  }, { behavior: 'immediate' })
  if (!result.skipped && result.versionId) scheduleVersionName(userId, planId, result.versionId)
  return result
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
    name: planVersions.name, nameSource: planVersions.nameSource, nameRevision: planVersions.nameRevision,
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
    name: planVersions.name, nameSource: planVersions.nameSource, nameRevision: planVersions.nameRevision,
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
    if (changed) appendSystemMessage(tx, opts.conversationId, result, `已切换到 v${result.version}（不新建版本，历史版本保留）`)
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
  const result = db.transaction((tx) => {
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
  if (!result.skipped && result.currentVersionId) scheduleVersionName(userId, planId, result.currentVersionId)
  return result
}

/** 内容未变不追加版本，但仍先检查客户端版本。 */
export async function savePlanVersion(
  userId: string,
  planId: number,
  opts: CommitOptions & { planJson?: unknown },
) {
  const result = db.transaction((tx) => {
    const snapshot = readSnapshot(tx, userId, planId, opts.source === 'ai' ? opts.messageId : undefined)
    assertVersion(snapshot, opts.expectedVersion, opts.expectedRevision)
    const next = opts.planJson === undefined ? snapshot.plan : parsePlanJson(opts.planJson, snapshot.plan)
    const result = commitMutation(tx, snapshot, next, opts)
    if (!result.skipped && result.versionId) appendSystemMessage(tx, opts.conversationId, result, `已保存为 v${result.version}`)
    return result
  }, { behavior: 'immediate' })
  if (!result.skipped && result.versionId) scheduleVersionName(userId, planId, result.versionId)
  return result
}

/** Called inside the synchronous run-finalization transaction; no provider requests here. */
export function finalizePlanRun(tx: Transaction, run: typeof chatRuns.$inferSelect, completed: boolean) {
  const draft = tx.select().from(planRunDrafts).where(and(eq(planRunDrafts.runId, run.id), eq(planRunDrafts.planId, run.planId), eq(planRunDrafts.messageId, run.assistantMessageId ?? -1))).get()
  if (!draft || draft.status !== 'active') return null
  if (!completed) {
    tx.update(planRunDrafts).set({ status: 'recoverable', updatedAt: new Date() }).where(eq(planRunDrafts.id, draft.id)).run()
    tx.update(messages).set({ previewJson: { ...toPlanPreview(parsePlanJson(draft.planJson), run.planId,
      draft.baseVersionId ? tx.select().from(planVersions).where(eq(planVersions.id, draft.baseVersionId)).get()?.version ?? 0 : 0,
      'ai', '本轮未完成，部分成果已保留为恢复草稿'), draftId: draft.id, status: 'recoverable' }, planVersionId: null }).where(eq(messages.id, draft.messageId)).run()
    return null
  }
  const snapshot = readSnapshot(tx, run.userId, run.planId)
  assertDraftBaseline(snapshot, draft)
  const next = parsePlanJson(draft.planJson, snapshot.plan)
  const unchanged = stableStringify(next) === stableStringify(snapshot.plan)
  const result = unchanged
    ? { versionId: snapshot.current?.id ?? null, preview: toPlanPreview(next, run.planId, snapshot.current?.version ?? 0, 'ai', '内容无变化，未生成新版本') }
    : commitVersion(tx, snapshot, next, { source: 'ai', messageId: draft.messageId, expectedRevision: draft.revision })
  tx.update(messages).set({ previewJson: result.preview, planVersionId: result.versionId }).where(eq(messages.id, draft.messageId)).run()
  tx.update(planRunDrafts).set({ status: unchanged ? 'discarded' : 'committed', resultVersionId: result.versionId, updatedAt: new Date() }).where(eq(planRunDrafts.id, draft.id)).run()
  return unchanged ? null : result.versionId
}

function readDraft(conn: Reader, userId: string, planId: number, draftId: number) {
  readPlan(conn, userId, planId)
  const draft = conn.select().from(planRunDrafts).where(and(eq(planRunDrafts.id, draftId), eq(planRunDrafts.planId, planId))).get()
  if (!draft) throw createError({ statusCode: 404, statusMessage: '恢复草稿不存在' })
  return draft
}

export function listPlanDrafts(userId: string, planId: number) {
  readPlan(db, userId, planId)
  return db.select({ id: planRunDrafts.id, runId: planRunDrafts.runId, messageId: planRunDrafts.messageId,
    baseVersionId: planRunDrafts.baseVersionId, baseRevision: planRunDrafts.baseRevision, revision: planRunDrafts.revision,
    status: planRunDrafts.status, resultVersionId: planRunDrafts.resultVersionId,
    createdAt: planRunDrafts.createdAt, updatedAt: planRunDrafts.updatedAt,
  }).from(planRunDrafts).where(and(eq(planRunDrafts.planId, planId), inArray(planRunDrafts.status, ['active', 'recoverable']))).orderBy(desc(planRunDrafts.id)).all()
}

export function getPlanDraft(userId: string, planId: number, draftId: number) {
  const { planJson, ...draft } = readDraft(db, userId, planId, draftId)
  return { ...draft, plan: parsePlanJson(planJson) }
}

/** Explicit recovery is a separate user operation, with its own optimistic concurrency check. */
export async function restorePlanDraft(userId: string, planId: number, draftId: number,
  opts: { expectedRevision: number; expectedVersion?: number; conversationId?: number },
) {
  const result = db.transaction(tx => {
    const draft = readDraft(tx, userId, planId, draftId)
    const snapshot = readSnapshot(tx, userId, planId)
    assertMessageScope(tx, snapshot.row, { ...opts, source: 'user' })
    if ((draft.status === 'committed' || draft.status === 'discarded') && draft.resultVersionId) {
      const version = tx.select().from(planVersions).where(and(eq(planVersions.id, draft.resultVersionId), eq(planVersions.planId, planId))).get()!
      const plan = parsePlanJson(version.planJson)
      return { planId, version: version.version, versionId: version.id, revision: snapshot.row.revision, skipped: true,
        preview: toPlanPreview(plan, planId, version.version, 'user', '该草稿已处理，未重复恢复'), plan }
    }
    if (draft.status !== 'recoverable') throw createError({ statusCode: 409, statusMessage: '草稿仍在生成或已处理，请刷新后重试' })
    assertVersion(snapshot, opts.expectedVersion, opts.expectedRevision)
    const next = parsePlanJson(draft.planJson, snapshot.plan)
    const saved = commitMutation(tx, snapshot, next, { ...opts, source: 'user', note: '用户确认恢复未完成草稿' })
    tx.update(planRunDrafts).set({ status: saved.skipped ? 'discarded' : 'committed', resultVersionId: saved.versionId, updatedAt: new Date() }).where(eq(planRunDrafts.id, draft.id)).run()
    tx.update(messages).set({ previewJson: { ...saved.preview, draftId: draft.id, status: 'recovered', message: `未完成草稿已由用户确认恢复至 v${saved.version}` }, planVersionId: saved.versionId }).where(eq(messages.id, draft.messageId)).run()
    if (!saved.skipped) appendSystemMessage(tx, opts.conversationId, saved, `已将未完成草稿恢复为 v${saved.version}`)
    return saved
  }, { behavior: 'immediate' })
  if (!result.skipped && result.versionId) scheduleVersionName(userId, planId, result.versionId)
  return result
}

export async function deletePlan(userId: string, planId: number) {
  const row = db.delete(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId)))
    .returning({ id: plans.id }).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: '规划不存在' })
  return { ok: true }
}

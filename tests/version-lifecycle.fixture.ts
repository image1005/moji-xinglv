import assert from 'node:assert/strict'
import { mock } from 'bun:test'
import { and, eq, sql } from 'drizzle-orm'
import * as h3 from 'h3'
import * as schema from '../server/database/schema'
import { emptyPlan } from '../shared/schemas/plan'
import { DraftSchema, PlanDraftDetailSchema, SaveResultSchema } from '../shared/schemas/workspace'
import { createMigratedTestDb } from './helpers/migrated-db'

const { sqlite, db } = createMigratedTestDb()
mock.module('../server/utils/db', () => ({ db, sqlite, schema }))
process.env.AI_API_KEY = ''
process.env.AI_GLOBAL_CONCURRENCY = '20'
process.env.AI_USER_CONCURRENCY = '10'
process.env.AI_REQUESTS_PER_PERIOD = '1000'
process.env.AI_GLOBAL_REQUESTS_PER_PERIOD = '1000'
const planService = await import('../server/services/plan')
const runs = await import('../server/services/chat-runs')
const { plans, planVersions, planRunDrafts, chatRuns, messages, conversations } = schema
const owner = 'lifecycle-owner'
sqlite.run('PRAGMA foreign_keys = ON')
db.insert(schema.user).values({ id: owner, name: '生命周期测试账号', email: 'lifecycle@example.test', createdAt: new Date(), updatedAt: new Date() }).run()
const identity = { text: '请完善行程', attachmentIds: [], configuration: { model: 'offline-test', webSearch: false, thinking: 'off' as const } }

async function begin(planId?: number) {
  planId ??= (await planService.createPlan(owner, emptyPlan('已成功行程'))).planId
  const conversation = db.insert(conversations).values({ userId: owner, planId, title: '生命周期测试' }).returning().get()
  const assistant = db.insert(messages).values({ conversationId: conversation.id, role: 'assistant', content: '部分说明' }).returning().get()
  const requestId = `request-${assistant.id}`
  const run = runs.claimRun(owner, requestId, planId, conversation.id, identity)
  runs.attachRunMessage(run.id, assistant.id)
  return { planId, messageId: assistant.id, conversationId: conversation.id, runId: run.id, requestId }
}

type Round = Awaited<ReturnType<typeof begin>>
const snapshot = (round: Round) => planService.getPlanSnapshot(owner, round.planId)
const versions = (round: Round) => db.select().from(planVersions).where(eq(planVersions.planId, round.planId)).all()
const draftRow = (round: Round) => db.select().from(planRunDrafts).where(eq(planRunDrafts.runId, round.runId)).get()!
const runRow = (round: Round) => db.select().from(chatRuns).where(eq(chatRuns.id, round.runId)).get()!
const previewRow = (round: Round) => db.select().from(messages).where(eq(messages.id, round.messageId)).get()!
const systems = (round: Round) => db.select().from(messages).where(and(eq(messages.conversationId, round.conversationId), eq(messages.role, 'system'))).all()
const patch = (round: Round, value: unknown, expectedRevision?: number) => planService.patchPlan(owner, round.planId, value, { source: 'ai', messageId: round.messageId, expectedRevision })

const cases: Record<string, () => Promise<void>> = {
  async finalOnly() {
    const round = await begin()
    const baseline = await snapshot(round)
    const first = await patch(round, { summary: '第一步中间成果' }, 1)
    const second = await patch(round, { summary: '最终摘要', tags: ['慢游'] }, first.revision)
    assert.equal(versions(round).length, 1)
    assert.equal(first.versionId, null)
    assert.equal(second.draftId, first.draftId)
    assert.equal(draftRow(round).status, 'active')
    assert.equal((await snapshot(round)).row.currentVersionId, baseline.row.currentVersionId)
    assert.deepEqual((await snapshot(round)).plan, baseline.plan)
    assert.equal((await planService.getPlanSnapshot(owner, round.planId, round.messageId)).plan.summary, '最终摘要')
    assert.equal(previewRow(round).planVersionId, null)
    assert.equal((previewRow(round).previewJson as { status: string }).status, 'draft')
    const finished = runs.finishRun(round.runId, 'completed')
    assert.equal(finished, 'completed', 'finishRun 保持同步调用契约')
    assert.equal(runRow(round).status, 'completed')
    assert.equal(versions(round).length, 2)
    const final = (await snapshot(round)).current!
    assert.equal(final.messageId, round.messageId)
    assert.equal(final.parentVersionId, baseline.current!.id)
    assert.equal((final.planJson as { summary: string }).summary, '最终摘要')
    assert.equal(draftRow(round).status, 'committed')
    assert.equal(draftRow(round).resultVersionId, final.id)
    assert.equal(previewRow(round).planVersionId, final.id)
    const finalState = await snapshot(round)
    runs.finishRun(round.runId, 'completed')
    runs.finishRun(round.runId, 'cancelled')
    assert.equal(runRow(round).status, 'completed')
    assert.equal((await snapshot(round)).row.revision, finalState.row.revision)
    await assert.rejects(patch(round, { summary: '迟到结果' }), { statusCode: 409 })
    assert.equal(versions(round).length, 2)
    assert.deepEqual((await planService.getVersionPlan(owner, round.planId, 1)), baseline.plan)
    assert.throws(() => runs.claimRun(owner, round.requestId, round.planId, round.conversationId, identity), { statusCode: 409 })
  },
  async noChange() {
    const round = await begin()
    const baseline = await snapshot(round)
    const first = await patch(round, { summary: baseline.plan.summary }, baseline.row.revision)
    assert.equal(first.skipped, true)
    assert.equal(first.revision, 1)
    assert.equal(draftRow(round), undefined, '无变化调用不创建草稿')
    const changed = await patch(round, { summary: '临时修改' }, first.revision)
    const repeated = await patch(round, { summary: '临时修改' }, changed.revision)
    assert.equal(repeated.skipped, true)
    assert.equal(repeated.revision, changed.revision)
    await patch(round, { summary: baseline.plan.summary }, repeated.revision)
    runs.finishRun(round.runId, 'completed')
    assert.equal(versions(round).length, 1, '整轮最终内容回到父版本不生成正式历史节点')
    assert.deepEqual((await snapshot(round)).plan, baseline.plan)
    for (let index = 0; index < 3; index++) {
      const current = await snapshot(round)
      const saved = await planService.savePlanVersion(owner, round.planId, { source: 'user', conversationId: round.conversationId, expectedRevision: current.row.revision, planJson: current.plan })
      assert.equal(saved.skipped, true)
      await planService.switchToVersion(owner, round.planId, 1, { conversationId: round.conversationId, expectedRevision: current.row.revision })
    }
    assert.equal(systems(round).length, 0, '重复保存和重复切换均不刷系统消息')
  },
  async incomplete() {
    for (const reason of ['failed', 'cancelled', 'timeout', 'restart'] as const) {
      const round = await begin()
      const before = await snapshot(round)
      await patch(round, { summary: `可恢复-${reason}` }, before.row.revision)
      if (reason === 'restart') assert.equal(runs.recoverInterruptedRuns(), 1)
      else runs.finishRun(round.runId, reason === 'timeout' ? 'failed' : reason, reason === 'timeout' ? 'timeout' : undefined)
      assert.equal(draftRow(round).status, 'recoverable')
      assert.equal(versions(round).length, 1)
      assert.deepEqual((await snapshot(round)).plan, before.plan)
      assert.equal((await snapshot(round)).row.currentVersionId, before.row.currentVersionId)
      assert.equal(previewRow(round).planVersionId, null)
      assert.equal((previewRow(round).previewJson as { status: string }).status, 'recoverable')
      assert.equal((await planService.listPlanDrafts(owner, round.planId)).length, 1)
      const state = await snapshot(round)
      runs.finishRun(round.runId, 'completed')
      assert.notEqual(runRow(round).status, 'completed', '先到终态胜出')
      assert.equal((await snapshot(round)).row.revision, state.row.revision)
      await assert.rejects(patch(round, { title: '结束后的迟到写入' }), { statusCode: 409 })
    }
    assert.equal(runs.recoverInterruptedRuns(), 0)
  },
  async restoreAndRetry() {
    const round = await begin()
    const edit = await patch(round, { summary: '未完成但有效的成果' }, 1)
    runs.finishRun(round.runId, 'failed', 'upstream_error')
    const draft = draftRow(round)
    const detail = await planService.getPlanDraft(owner, round.planId, draft.id)
    assert.equal(detail.plan.summary, '未完成但有效的成果')
    assert.throws(() => planService.listPlanDrafts('intruder', round.planId), { statusCode: 404 })
    assert.throws(() => planService.getPlanDraft('intruder', round.planId, draft.id), { statusCode: 404 })
    await assert.rejects(planService.restorePlanDraft('intruder', round.planId, draft.id, { expectedRevision: edit.revision }), { statusCode: 404 })
    const other = await planService.createPlan(owner, emptyPlan('另一工作区'))
    assert.throws(() => planService.getPlanDraft(owner, other.planId, draft.id), { statusCode: 404 })
    await assert.rejects(planService.restorePlanDraft(owner, other.planId, draft.id, { expectedRevision: 1 }), { statusCode: 404 })
    await assert.rejects(planService.restorePlanDraft(owner, round.planId, draft.id, { expectedRevision: 1 }), { statusCode: 409 })
    const restored = await planService.restorePlanDraft(owner, round.planId, draft.id, { expectedRevision: edit.revision, expectedVersion: 1, conversationId: round.conversationId })
    assert.equal(restored.version, 2)
    assert.equal((await snapshot(round)).plan.summary, detail.plan.summary)
    assert.equal((await snapshot(round)).current!.source, 'user')
    assert.equal(systems(round).length, 1)
    const manual = await planService.savePlanVersion(owner, round.planId, { source: 'user', planJson: { ...(await snapshot(round)).plan, title: '恢复后的独立编辑' }, expectedRevision: restored.revision })
    const after = await snapshot(round)
    const retry = await planService.restorePlanDraft(owner, round.planId, draft.id, { expectedRevision: edit.revision, conversationId: round.conversationId })
    assert.equal(retry.skipped, true)
    assert.equal(versions(round).length, 3)
    assert.equal((await snapshot(round)).row.currentVersionId, manual.versionId)
    assert.deepEqual((await snapshot(round)).plan, after.plan, '重试不得重新覆盖后来保存的内容')
    assert.equal((await snapshot(round)).row.revision, after.row.revision)
    assert.equal(systems(round).length, 1)
  },
  async concurrentManualAndFork() {
    const round = await begin()
    const old = await snapshot(round)
    const edit = await patch(round, { summary: 'AI 部分成果' }, 1)
    const manual = await planService.savePlanVersion(owner, round.planId, { source: 'user', planJson: { ...old.plan, title: '独立手工保存' }, expectedRevision: edit.revision })
    assert.equal(runs.finishRun(round.runId, 'completed'), 'failed')
    assert.equal(runRow(round).errorCode, 'version_conflict')
    assert.equal(draftRow(round).status, 'recoverable')
    assert.equal((await snapshot(round)).plan.title, '独立手工保存')
    assert.equal(versions(round).length, 2)
    await assert.rejects(planService.savePlanVersion(owner, round.planId, { source: 'user', planJson: old.plan, expectedVersion: 1, expectedRevision: 1 }), { statusCode: 409 })
    const switched = await planService.switchToVersion(owner, round.planId, 1, { expectedVersion: 2, expectedRevision: manual.revision })
    const restored = await planService.restorePlanDraft(owner, round.planId, draftRow(round).id, { expectedVersion: 1, expectedRevision: switched.revision })
    assert.equal(restored.version, 3)
    assert.equal((await snapshot(round)).current!.parentVersionId, old.current!.id)
    assert.equal((await planService.getVersionPlan(owner, round.planId, 2)).title, '独立手工保存')
    const next = await begin(round.planId)
    const beforeSwitch = await snapshot(next)
    await patch(next, { summary: '切换前新草稿' }, beforeSwitch.row.revision)
    const beforeMove = await snapshot(next)
    await planService.switchToVersion(owner, next.planId, 2, { expectedRevision: beforeMove.row.revision })
    assert.equal(runs.finishRun(next.runId, 'completed'), 'failed')
    assert.equal(runRow(next).errorCode, 'version_conflict')
    assert.equal((await snapshot(next)).plan.title, '独立手工保存')
    assert.equal(draftRow(next).status, 'recoverable')
    assert.equal(versions(next).length, 3)
  },
  async restoreNoop() {
    const round = await begin()
    await patch(round, { summary: '同一结果' }, 1)
    runs.finishRun(round.runId, 'cancelled')
    const before = await snapshot(round)
    const manual = await planService.savePlanVersion(owner, round.planId, { source: 'user', planJson: { ...before.plan, summary: '同一结果' }, expectedRevision: before.row.revision })
    const restored = await planService.restorePlanDraft(owner, round.planId, draftRow(round).id, { expectedRevision: manual.revision, conversationId: round.conversationId })
    assert.equal(restored.skipped, true)
    assert.equal(versions(round).length, 2)
    assert.equal((await snapshot(round)).row.revision, manual.revision)
    assert.equal(systems(round).length, 0)
  },
  async rollback() {
    const round = await begin()
    db.run(sql.raw("CREATE TRIGGER reject_draft_preview BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT, 'draft preview rejected'); END"))
    await assert.rejects(patch(round, { summary: '不应有部分写入' }, 1))
    assert.equal(draftRow(round), undefined)
    assert.equal((await snapshot(round)).row.revision, 1)
    assert.equal(versions(round).length, 1)
    db.run(sql.raw('DROP TRIGGER reject_draft_preview'))
    await patch(round, { summary: '需要恢复的有效部分' }, 1)
    db.run(sql.raw("CREATE TRIGGER reject_final_version BEFORE INSERT ON plan_versions BEGIN SELECT RAISE(ABORT, 'final rejected'); END"))
    assert.throws(() => runs.finishRun(round.runId, 'completed'))
    assert.equal(versions(round).length, 1)
    assert.equal((await snapshot(round)).plan.summary, '')
    assert.equal(runRow(round).status, 'running', '终态与最终提交必须原子完成')
    runs.finishRun(round.runId, 'failed', 'commit_failed')
    assert.equal(draftRow(round).status, 'recoverable')
    db.run(sql.raw('DROP TRIGGER reject_final_version'))
    db.run(sql.raw("CREATE TRIGGER reject_restore_message BEFORE INSERT ON messages WHEN NEW.role = 'system' BEGIN SELECT RAISE(ABORT, 'restore notification rejected'); END"))
    const before = await snapshot(round)
    await assert.rejects(planService.restorePlanDraft(owner, round.planId, draftRow(round).id, { expectedRevision: before.row.revision, conversationId: round.conversationId }))
    assert.equal(versions(round).length, 1)
    assert.equal(draftRow(round).status, 'recoverable')
    assert.equal((await snapshot(round)).row.revision, before.row.revision)
  },
  async http() {
    const foreignPlan = await planService.createPlan(owner, emptyPlan('另一规划'))
    const foreignConversation = db.insert(conversations).values({ userId: owner, planId: foreignPlan.planId, title: '别处' }).returning().get()
    const round = await begin()
    const edit = await patch(round, { summary: '需要显式恢复的部分' }, 1)
    const draftId = draftRow(round).id
    Object.assign(globalThis, { defineEventHandler: h3.defineEventHandler, getRouterParam: h3.getRouterParam, createError: h3.createError, readValidatedBody: h3.readValidatedBody })
    mock.module('../server/utils/session', () => ({ requireUser: async (event: h3.H3Event) => {
      const id = h3.getHeader(event, 'x-test-owner')
      if (!id) throw h3.createError({ statusCode: 401 })
      return { id }
    } }))
    const listRoute = (await import('../server/api/plans/[id]/drafts.get')).default
    const detailRoute = (await import('../server/api/plans/[id]/drafts/[draftId].get')).default
    const restoreRoute = (await import('../server/api/plans/[id]/drafts/[draftId]/restore.post')).default
    const versionRoute = (await import('../server/api/plans/[id]/versions/[version].get')).default
    const app = h3.createApp()
    app.use(h3.createRouter()
      .get('/api/plans/:id/drafts', listRoute)
      .get('/api/plans/:id/drafts/:draftId', detailRoute)
      .post('/api/plans/:id/drafts/:draftId/restore', restoreRoute)
      .get('/api/plans/:id/versions/:version', versionRoute))
    const handler = h3.toWebHandler(app)
    const request = (path: string, body?: unknown, userId: string | null = owner) => handler(new Request(`http://localhost${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(userId ? { 'x-test-owner': userId } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }))
    const path = `/api/plans/${round.planId}/drafts`
    const detailPath = `${path}/${draftId}`
    const restorePath = `${detailPath}/restore`
    assert.equal((await request(path, undefined, null)).status, 401)
    const active = await request(path)
    assert.equal(active.status, 200)
    const activeBody = await active.json() as { drafts: unknown[] }
    assert.equal(activeBody.drafts.length, 1)
    assert.equal(DraftSchema.parse(activeBody.drafts[0]).status, 'active')
    assert.equal((await request(restorePath, { expectedRevision: edit.revision })).status, 409, '执行中的草稿不能恢复')
    runs.finishRun(round.runId, 'failed', 'offline_failure')
    const detail = await request(detailPath)
    assert.equal(detail.status, 200)
    const parsed = PlanDraftDetailSchema.parse((await detail.json() as { draft: unknown }).draft)
    assert.equal(parsed.plan.summary, '需要显式恢复的部分')
    assert.equal(parsed.status, 'recoverable')
    assert.equal(parsed.planId, round.planId)
    for (const endpoint of [path, detailPath]) assert.equal((await request(endpoint, undefined, 'intruder')).status, 404)
    assert.equal((await request(restorePath, { expectedRevision: edit.revision }, 'intruder')).status, 404)
    assert.equal((await request(`/api/plans/${foreignPlan.planId}/drafts/${draftId}`)).status, 404)
    assert.equal((await request(`/api/plans/${foreignPlan.planId}/drafts/${draftId}/restore`, { expectedRevision: 1 })).status, 404)
    for (const invalid of ['NaN', '0', '-1', '1.5', '9007199254740992']) {
      assert.equal((await request(`/api/plans/${invalid}/drafts`)).status, 400)
      assert.equal((await request(`${path}/${invalid}`)).status, 400)
      assert.equal((await request(`${path}/${invalid}/restore`, { expectedRevision: edit.revision })).status, 400)
    }
    for (const body of [{}, { expectedRevision: 0 }, { expectedRevision: 1.5 }, { expectedRevision: '2' }, { expectedRevision: edit.revision, expectedVersion: -1 }, { expectedRevision: edit.revision, conversationId: 0 }]) {
      assert.equal((await request(restorePath, body)).status, 400)
    }
    assert.equal((await request(restorePath, { expectedRevision: 1 })).status, 409)
    assert.equal((await request(restorePath, { expectedRevision: edit.revision, conversationId: foreignConversation.id })).status, 404)
    assert.equal(versions(round).length, 1)
    const restored = await request(restorePath, { expectedRevision: edit.revision, expectedVersion: 1, conversationId: round.conversationId })
    assert.equal(restored.status, 200)
    const saved = SaveResultSchema.parse(await restored.json())
    assert.equal(saved.version, 2)
    assert.equal(saved.skipped, false)
    assert.equal(runRow(round).status, 'failed', '恢复不伪造原始运行完成状态')
    assert.equal((previewRow(round).previewJson as { status: string }).status, 'recovered')
    assert.equal(previewRow(round).planVersionId, saved.versionId)
    assert.deepEqual(await (await request(path)).json(), { drafts: [] })
    const historical = await request(`/api/plans/${round.planId}/versions/2`)
    assert.equal(historical.status, 200)
    assert.equal((await historical.json() as { plan: { summary: string } }).plan.summary, '需要显式恢复的部分')
    assert.equal((await request(`/api/plans/${round.planId}/versions/${saved.versionId}`)).status, 404, '历史快照仍按展示版本号读取')
    const repeated = await request(restorePath, { expectedRevision: edit.revision, conversationId: round.conversationId })
    assert.equal(repeated.status, 200)
    assert.equal(SaveResultSchema.parse(await repeated.json()).skipped, true)
    assert.equal(systems(round).length, 1)
    assert.equal(versions(round).length, 2)
  },
  async migration() {
    const legacy = createMigratedTestDb(5)
    try {
      legacy.sqlite.run('PRAGMA foreign_keys = ON')
      legacy.db.insert(schema.user).values({ id: 'legacy', name: '历史账号', email: 'legacy@example.test', createdAt: new Date(), updatedAt: new Date() }).run()
      const original = emptyPlan('旧数据库原始内容')
      const content = JSON.stringify(original)
      legacy.sqlite.run("INSERT INTO plans (id,user_id,title,plan_json,current_version_id,revision,created_at,updated_at) VALUES (1,'legacy','旧数据库原始内容',?,102,12,100,200)", [content])
      for (const [id, version, parent] of [[101, 1, null], [102, 2, 101], [103, 3, 101]] as const) {
        legacy.sqlite.run("INSERT INTO plan_versions (id,plan_id,version,plan_json,created_by,created_at,parent_version_id,source,diff_json,message_id) VALUES (?,1,?,?,'legacy',100,?,'user','[]',NULL)", [id, version, content, parent])
      }
      legacy.migrateToLatest()
      const rows = legacy.db.select().from(planVersions).all()
      assert.equal(rows.length, 3)
      assert.deepEqual(rows.map(row => [row.id, row.parentVersionId]), [[101, null], [102, 101], [103, 101]])
      for (const row of rows) {
        assert.deepEqual(row.planJson, original)
        assert.equal(row.name, null)
        assert.equal(row.nameSource, null)
        assert.equal(row.nameRevision, 0)
      }
      const old = legacy.db.select().from(plans).get()!
      assert.equal(old.currentVersionId, 102)
      assert.equal(old.revision, 12)
      assert.equal(legacy.db.select().from(planRunDrafts).all().length, 0)
      legacy.migrateToLatest()
      assert.equal(legacy.db.select().from(planVersions).all().length, 3, '重复迁移不删除或重建已有历史')
      assert.deepEqual(legacy.sqlite.query('PRAGMA foreign_key_check').all(), [])
    } finally { legacy.sqlite.close() }
  },
}

try {
  const name = process.argv[2]!
  assert.ok(cases[name], `Unknown lifecycle case: ${name}`)
  await cases[name]!()
  assert.deepEqual(sqlite.query('PRAGMA foreign_key_check').all(), [], '生产外键约束下无悬挂引用')
} finally { sqlite.close() }

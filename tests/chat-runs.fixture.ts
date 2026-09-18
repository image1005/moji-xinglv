import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { mock } from 'bun:test'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { eq, sql } from 'drizzle-orm'
import * as schema from '../server/database/schema'
import { emptyPlan } from '../shared/schemas/plan'

// Bun-only memory connection; this fixture never imports the real db.ts or .env.
const sqlite = new Database(':memory:')
const db = drizzle(sqlite, { schema })
for (const ddl of [
  "CREATE TABLE plans (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', content_md TEXT NOT NULL DEFAULT '', plan_json TEXT NOT NULL, cover_url TEXT NOT NULL DEFAULT '', current_version_id INTEGER, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  'CREATE TABLE plan_versions (id INTEGER PRIMARY KEY, plan_id INTEGER NOT NULL, version INTEGER NOT NULL, plan_json TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL, parent_version_id INTEGER, source TEXT NOT NULL, diff_json TEXT, message_id INTEGER, UNIQUE(plan_id, version))',
  'CREATE TABLE conversations (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, plan_id INTEGER NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE TABLE messages (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, tool_calls TEXT, parts_json TEXT, preview_json TEXT, plan_version_id INTEGER, created_at INTEGER NOT NULL)',
  'CREATE TABLE chat_runs (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL, configuration_json TEXT, plan_id INTEGER NOT NULL, conversation_id INTEGER NOT NULL, assistant_message_id INTEGER, status TEXT NOT NULL, steps INTEGER NOT NULL DEFAULT 0, error_code TEXT, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER, UNIQUE(user_id, request_id))',
  "CREATE TABLE usage_metrics (id INTEGER PRIMARY KEY, day TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '', service TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, cache_hits INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, usage_samples INTEGER NOT NULL DEFAULT 0, steps INTEGER NOT NULL DEFAULT 0, UNIQUE(day,user_id,service))",
]) db.run(sql.raw(ddl))
mock.module('../server/utils/db', () => ({ db, sqlite, schema }))
const runs = await import('../server/services/chat-runs')
const metrics = await import('../server/services/metrics')
const planService = await import('../server/services/plan')
const conversationService = await import('../server/services/conversation')
const { includeInitialRequirements } = await import('../server/services/ai-history')
const { chatRuns, messages } = schema
process.env.AI_GLOBAL_CONCURRENCY = '2'
process.env.AI_USER_CONCURRENCY = '1'
process.env.AI_QUEUE_LIMIT = '1'
process.env.AI_QUEUE_WAIT_MS = '500'
process.env.AI_REQUESTS_PER_PERIOD = '60'
process.env.AI_GLOBAL_REQUESTS_PER_PERIOD = '1000'

const requestInput = (text: string) => ({ text, attachmentIds: [], configuration: { model: 'test-model', webSearch: false, thinking: 'off' as const } })

const cases: Record<string, () => Promise<void>> = {
  async identity() {
    const first = runs.claimRun('owner', 'request-first', 1, 1, requestInput('新增一天'))
    for (const status of ['running', 'completed', 'cancelled', 'interrupted'] as const) {
      db.update(chatRuns).set({ status }).where(eq(chatRuns.id, first.id)).run()
      assert.throws(() => runs.claimRun('owner', 'request-first', 1, 1, requestInput('新增一天')), { statusCode: 409, data: { ...runs.publicRun(db.select().from(chatRuns).where(eq(chatRuns.id, first.id)).get()!) } })
    }
    assert.throws(() => runs.claimRun('owner', 'request-first', 1, 1, requestInput('不同需求')), { statusCode: 409 })
    assert.equal(runs.claimRun('other', 'request-first', 2, 2, requestInput('新增一天')).status, 'running')
    assert.equal(db.select().from(chatRuns).all().length, 2)
    const configuration = { model: 'test-model', webSearch: false, thinking: 'off' as const }
    const base = { text: '同一问题', attachmentIds: ['photo-a'], configuration }
    const snapshots = [base, { ...base, attachmentIds: ['photo-b'] }, { ...base, configuration: { ...configuration, webSearch: true } }, { ...base, configuration: { ...configuration, thinking: 'deep' as const } }, { ...base, configuration: { ...configuration, model: 'vision-model' } }]
    const hashes = new Set<string>()
    for (const [index, input] of snapshots.entries()) {
      const task = runs.claimRun('config-owner', `config-request-${index}`, 10, 10, input)
      hashes.add(task.requestHash)
      assert.deepEqual(task.configurationJson, input.configuration)
      runs.finishRun(task.id, 'completed')
    }
    assert.equal(hashes.size, snapshots.length, '图片、模型、搜索与思考配置各自参与幂等身份')
    assert.throws(() => runs.claimRun('config-owner', 'config-request-0', 10, 10, snapshots[1]!), (error: unknown) => String((error as Error).message).includes('其他内容'))
  },
  async queue() {
    const first = runs.claimRun('owner', 'request-first', 1, 1, requestInput('需求'))
    const queued = runs.claimRun('owner', 'request-queued', 2, 2, requestInput('需求'))
    assert.equal(queued.status, 'queued')
    assert.equal(runs.claimRun('other', 'request-other', 3, 3, requestInput('需求')).status, 'running')
    assert.throws(() => runs.claimRun('third', 'request-third', 4, 4, requestInput('需求')), { statusCode: 429 })
    const pending = runs.waitForRun(queued.id, new AbortController().signal)
    runs.finishRun(first.id, 'completed')
    await pending
    assert.equal(db.select().from(chatRuns).where(eq(chatRuns.id, queued.id)).get()!.status, 'running')
    runs.finishRun(queued.id, 'cancelled')
    const timeout = runs.claimRun('other', 'request-timeout', 5, 5, requestInput('需求'))
    await assert.rejects(runs.waitForRun(timeout.id, new AbortController().signal), { statusCode: 429 })
    assert.equal(db.select().from(chatRuns).where(eq(chatRuns.id, timeout.id)).get()!.errorCode, 'queue_timeout')
  },
  async quota() {
    process.env.AI_REQUESTS_PER_PERIOD = '2'
    process.env.AI_PERIOD_SECONDS = '3600'
    const first = runs.claimRun('owner', 'request-first', 1, 1, requestInput('需求'))
    runs.finishRun(first.id, 'completed')
    const second = runs.claimRun('owner', 'request-second', 1, 1, requestInput('需求'))
    runs.finishRun(second.id, 'failed')
    assert.throws(() => runs.claimRun('owner', 'request-third', 1, 1, requestInput('需求')), (error: unknown) => {
      const failure = error as { statusCode: number; data: { retryAfter: number } }
      return failure.statusCode === 429 && failure.data.retryAfter > 3590
    })
    db.update(chatRuns).set({ startedAt: new Date(Date.now() - 3601000) }).run()
    assert.equal(runs.claimRun('owner', 'request-third', 1, 1, requestInput('需求')).status, 'running')
    process.env.AI_GLOBAL_REQUESTS_PER_PERIOD = '1'
    assert.throws(() => runs.claimRun('other', 'request-global', 2, 2, requestInput('需求')), { statusCode: 429 })
  },
  async checkpointRecovery() {
    const plan = await planService.createPlan('owner', emptyPlan('可恢复规划'))
    const conversation = await conversationService.createConversation('owner', plan.planId)
    const assistant = await conversationService.appendMessage(conversation.id, { role: 'assistant', content: '已生成的部分文字' })
    const task = runs.claimRun('owner', 'request-recover', plan.planId, conversation.id, requestInput('新增一天'))
    runs.attachRunMessage(task.id, assistant.id)
    const edit = await planService.applyPlanEdits('owner', plan.planId, [{ target: 'day', action: 'add', value: { city: '杭州' } }], { messageId: assistant.id, expectedRevision: 1 })
    runs.checkpointRun(task.id, 1)
    // No stream output/finalization has occurred: the version transaction is the recovery record.
    const committed = db.select().from(messages).where(eq(messages.id, assistant.id)).get()!
    assert.equal(committed.planVersionId, edit.versionId)
    assert.deepEqual(committed.previewJson, JSON.parse(JSON.stringify(edit.preview)))
    assert.equal(runs.recoverInterruptedRuns(), 1)
    const recovered = db.select().from(messages).where(eq(messages.id, assistant.id)).get()!
    assert.deepEqual(recovered.previewJson, JSON.parse(JSON.stringify(edit.preview)))
    assert.match(recovered.content, /已生成的部分文字/)
    assert.match(recovered.content, /服务重启中断/)
    assert.equal(runs.listRuns('owner', conversation.id)[0]!.status, 'interrupted')
    assert.throws(() => runs.listRuns('other', conversation.id), { statusCode: 404 })
    assert.equal(runs.recoverInterruptedRuns(), 0)
    assert.throws(() => runs.claimRun('owner', 'request-recover', plan.planId, conversation.id, requestInput('新增一天')), { statusCode: 409 })
  },
  async metrics() {
    metrics.recordMetric({ service: 'staticmap', userId: 'owner', outcome: 'success', durationMs: 50 })
    metrics.recordMetric({ service: 'staticmap', userId: 'owner', outcome: 'cache_hit' })
    metrics.recordMetric({ service: 'staticmap', userId: 'owner', outcome: 'cache_hit' })
    metrics.recordMetric({ service: 'staticmap', userId: 'owner', outcome: 'error', durationMs: 20 })
    metrics.recordMetric({ service: 'staticmap', userId: 'other', outcome: 'success', durationMs: 100 })
    const owner = metrics.metricTotals('owner')[0]!
    assert.deepEqual([owner.requests, owner.errors, owner.cacheHits, owner.durationMs, owner.usageSamples], [2, 1, 2, 70, 0])
    assert.equal(metrics.metricTotals()[0]!.requests, 3)
    metrics.recordMetric({ service: 'ai', userId: 'owner', outcome: 'success', inputTokens: 123, outputTokens: 12, steps: 1 })
    assert.equal(metrics.metricTotals('owner').find(row => row.service === 'ai')!.usageSamples, 1)
  },
  async initialRequirements() {
    const plan = await planService.createPlan('owner', emptyPlan('长对话'))
    const conversation = await conversationService.createConversation('owner', plan.planId)
    const first = await conversationService.appendMessage(conversation.id, { role: 'user', content: '预算不超过两千元，带老人慢行。' })
    for (let i = 0; i < 260; i++) await conversationService.appendMessage(conversation.id, { role: i % 2 ? 'assistant' : 'user', content: `后续讨论${i}` })
    const recent = await conversationService.listMessages(conversation.id, 60)
    assert.ok(!recent.some(row => row.id === first.id))
    const context = includeInitialRequirements('owner', conversation.id, recent)
    assert.equal(context[0]!.id, first.id)
    assert.equal(context.filter(row => row.id === first.id).length, 1)
    assert.equal(includeInitialRequirements('other', conversation.id, []).length, 0)
  },
}

try {
  const name = process.argv[2]!
  assert.ok(cases[name], `Unknown case: ${name}`)
  await cases[name]!()
} finally { sqlite.close() }

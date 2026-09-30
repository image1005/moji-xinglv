import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { Database } from 'bun:sqlite'
import { mock } from 'bun:test'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { eq } from 'drizzle-orm'
import * as h3 from 'h3'
import * as schema from '../server/database/schema'
import { emptyPlan, PlanSchema } from '../shared/schemas/plan'
import { VersionSchema } from '../shared/schemas/workspace'

const sqlite = new Database(':memory:')
const db = drizzle(sqlite, { schema })
migrate(db, { migrationsFolder: fileURLToPath(new URL('../server/database/migrations', import.meta.url)) })
mock.module('../server/utils/db', () => ({ db }))
process.env.AI_API_KEY = ''
const names = await import('../server/services/version-names')
const { plans, planVersions } = schema
for (const id of ['owner', 'other']) db.insert(schema.user).values({ id, name: id, email: `${id}@example.invalid`, createdAt: new Date(), updatedAt: new Date() }).run()

function seed(userId = 'owner') {
  const original = PlanSchema.parse({ ...emptyPlan('杭州行程'), days: [{ city: '杭州', spots: [{ name: '西湖' }] }] })
  const final = PlanSchema.parse({ ...original, days: [{ city: '杭州', spots: [{ name: '西湖' }, { name: '灵隐寺' }] }] })
  const plan = db.insert(plans).values({ userId, title: final.title, planJson: final }).returning().get()
  const parent = db.insert(planVersions).values({ planId: plan.id, version: 1, planJson: original, createdBy: userId, source: 'user' }).returning().get()
  const version = db.insert(planVersions).values({ planId: plan.id, version: 2, parentVersionId: parent.id, planJson: final,
    createdBy: userId, source: 'ai', name: names.fallbackVersionName(final, original), nameSource: 'fallback', nameRevision: 0 }).returning().get()
  db.update(plans).set({ currentVersionId: version.id }).where(eq(plans.id, plan.id)).run()
  return { planId: plan.id, parent, version, original, final }
}
const read = (id: number) => db.select().from(planVersions).where(eq(planVersions.id, id)).get()!
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))
function deferred() {
  let resolve!: (name: string) => void
  const promise = new Promise<string>(done => { resolve = done })
  return { promise, resolve }
}

const cases: Record<string, () => Promise<void>> = {
  async rename() {
    seed('other') // Make version identities differ from display version numbers.
    const seeded = seed()
    const before = db.select().from(plans).where(eq(plans.id, seeded.planId)).get()
    const rowsBefore = db.select().from(planVersions).all()
    const result = names.renameVersion('owner', seeded.planId, 2, { name: '  灵隐礼佛与西湖晨游  ', expectedNameRevision: 0 })
    assert.equal(result.id, seeded.version.id)
    assert.equal(result.name, '灵隐礼佛与西湖晨游')
    assert.equal(result.nameSource, 'user')
    assert.equal(result.nameRevision, 1)
    assert.deepEqual(db.select().from(plans).where(eq(plans.id, seeded.planId)).get(), before)
    assert.equal(db.select().from(planVersions).all().length, rowsBefore.length)
    const { name: _name, nameSource: _source, nameRevision: _revision, ...unchanged } = read(seeded.version.id)
    const { name: _oldName, nameSource: _oldSource, nameRevision: _oldRevision, ...prior } = seeded.version
    assert.deepEqual(unchanged, prior)
    assert.throws(() => names.renameVersion('owner', seeded.planId, 2, { name: '并发覆盖', expectedNameRevision: 0 }), { statusCode: 409 })
    assert.throws(() => names.renameVersion('owner', seeded.planId, 2, { name: ' ', expectedNameRevision: 1 }), { statusCode: 400 })
    assert.throws(() => names.renameVersion('owner', seeded.planId, 2, { name: '名称', expectedNameRevision: -1 }), { statusCode: 400 })
  },
  async scope() {
    const own = seed()
    const other = seed('other')
    assert.throws(() => names.renameVersion('other', own.planId, 2, { name: '越权', expectedNameRevision: 0 }), { statusCode: 404 })
    assert.throws(() => names.renameVersion('owner', other.planId, 2, { name: '越权', expectedNameRevision: 0 }), { statusCode: 404 })
    let requests = 0
    names.scheduleVersionName('owner', own.planId, other.version.id, async () => { requests++; return '不应命名' })
    names.scheduleVersionName('other', own.planId, own.version.id, async () => { requests++; return '不应命名' })
    await tick()
    assert.equal(requests, 0)
    const pending = deferred()
    names.scheduleVersionName('owner', own.planId, own.version.id, () => pending.promise)
    await tick()
    db.update(plans).set({ userId: 'other' }).where(eq(plans.id, own.planId)).run()
    pending.resolve('迟到名称')
    await tick()
    assert.equal(read(own.version.id).nameSource, 'fallback')
  },
  async success() {
    const seeded = seed()
    let requests = 0
    const pending = deferred()
    const generate = async (input: { plan: unknown; parent?: unknown }) => {
      requests++
      assert.equal(sqlite.inTransaction, false, '模型请求必须在数据库事务外')
      assert.deepEqual(input.plan, seeded.final)
      assert.deepEqual(input.parent, seeded.original)
      return pending.promise
    }
    names.scheduleVersionName('owner', seeded.planId, seeded.version.id, generate)
    names.scheduleVersionName('owner', seeded.planId, seeded.version.id, generate)
    assert.equal(read(seeded.version.id).nameRevision, 1, '同步留下持久命名申请与回退名')
    assert.equal(requests, 0, '同步调用不等待模型')
    await tick()
    assert.equal(requests, 1)
    pending.resolve('西湖晨游与灵隐礼佛')
    await tick()
    assert.equal(read(seeded.version.id).name, '西湖晨游与灵隐礼佛')
    assert.equal(read(seeded.version.id).nameSource, 'ai')
    assert.equal(read(seeded.version.id).nameRevision, 2)
    names.scheduleVersionName('owner', seeded.planId, seeded.version.id, generate)
    await tick()
    assert.equal(requests, 1)
  },
  async fallback() {
    for (const invalid of [undefined, ' ', '<b>名称</b>', '名'.repeat(41)]) {
      const seeded = seed()
      let requests = 0
      const generate = async () => { requests++; if (invalid === undefined) throw new Error('供应商不可用'); return invalid }
      names.scheduleVersionName('owner', seeded.planId, seeded.version.id, generate)
      await tick()
      names.scheduleVersionName('owner', seeded.planId, seeded.version.id, generate)
      await tick()
      assert.equal(requests, 1)
      assert.equal(read(seeded.version.id).nameSource, 'fallback')
      assert.equal(read(seeded.version.id).name, '杭州·日程调整')
      assert.equal(read(seeded.version.id).nameRevision, 1)
    }
  },
  async userPriority() {
    const seeded = seed()
    const pending = deferred()
    names.scheduleVersionName('owner', seeded.planId, seeded.version.id, () => pending.promise)
    await tick()
    names.renameVersion('owner', seeded.planId, 2, { name: '我和家人的西湖行', expectedNameRevision: 1 })
    pending.resolve('迟到的模型名称')
    await tick()
    assert.equal(read(seeded.version.id).name, '我和家人的西湖行')
    assert.equal(read(seeded.version.id).nameSource, 'user')
    assert.equal(read(seeded.version.id).nameRevision, 2)
    names.scheduleVersionName('owner', seeded.planId, seeded.version.id, async () => { throw new Error('人工命名不能重新请求') })
    await tick()
    assert.equal(read(seeded.version.id).nameSource, 'user')
  },
  async snapshotRace() {
    for (const race of ['snapshot', 'parentId', 'parentSnapshot', 'identity', 'revision']) {
      const seeded = seed()
      const pending = deferred()
      names.scheduleVersionName('owner', seeded.planId, seeded.version.id, () => pending.promise)
      await tick()
      if (race === 'snapshot') db.update(planVersions).set({ planJson: { ...seeded.final, summary: '变更后' } }).where(eq(planVersions.id, seeded.version.id)).run()
      if (race === 'parentId') db.update(planVersions).set({ parentVersionId: null }).where(eq(planVersions.id, seeded.version.id)).run()
      if (race === 'parentSnapshot') db.update(planVersions).set({ planJson: { ...seeded.original, summary: '父快照已变' } }).where(eq(planVersions.id, seeded.parent.id)).run()
      if (race === 'identity') db.update(planVersions).set({ version: 3 }).where(eq(planVersions.id, seeded.version.id)).run()
      if (race === 'revision') db.update(planVersions).set({ nameRevision: 2 }).where(eq(planVersions.id, seeded.version.id)).run()
      pending.resolve('不应写入')
      await tick()
      assert.equal(read(seeded.version.id).nameSource, 'fallback', race)
    }
  },
  async http() {
    seed('other')
    const seeded = seed()
    Object.assign(globalThis, { defineEventHandler: h3.defineEventHandler, getRouterParam: h3.getRouterParam, createError: h3.createError, readValidatedBody: h3.readValidatedBody })
    mock.module('../server/utils/session', () => ({ requireUser: async (event: h3.H3Event) => ({ id: h3.getHeader(event, 'x-test-owner') ?? 'owner' }) }))
    const route = (await import('../server/api/plans/[id]/versions/[version]/name.patch')).default
    const app = h3.createApp()
    const router = h3.createRouter().patch('/api/plans/:id/versions/:version/name', route)
    app.use(router)
    const handler = h3.toWebHandler(app)
    const request = (body: unknown, version: number | string = 2, userId = 'owner') => handler(new Request(`http://localhost/api/plans/${seeded.planId}/versions/${version}/name`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'x-test-owner': userId }, body: JSON.stringify(body),
    }))
    for (const name of ['', ' ', '<b>名称</b>', '名称\n新行', '字'.repeat(41), null, 42]) {
      assert.equal((await request({ name, expectedNameRevision: 0 })).status, 400)
    }
    assert.equal((await request({ name: '越权', expectedNameRevision: 0 }, 2, 'other')).status, 404)
    assert.equal((await request({ name: '未知', expectedNameRevision: 0 }, seeded.version.id)).status, 404)
    assert.equal((await request({ name: '未知', expectedNameRevision: 0 }, 'NaN')).status, 400)
    const response = await request({ name: '  西湖与灵隐  ', expectedNameRevision: 0 })
    assert.equal(response.status, 200)
    const body = await response.json() as { version: unknown }
    const version = VersionSchema.parse(body.version)
    assert.equal(version.name, '西湖与灵隐')
    assert.equal(version.id, seeded.version.id)
    assert.equal((await request({ name: '重复请求', expectedNameRevision: 0 })).status, 409)
  },
  async model() {
    const seeded = seed()
    let requests = 0
    let prompt = ''
    const mockServer = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      assert.equal(new URL(request.url).pathname, '/v1/chat/completions')
      requests++
      const input = await request.json() as { messages: unknown; stream?: boolean }
      prompt = JSON.stringify(input.messages)
      const content = JSON.stringify({ name: '灵隐礼佛纳入西湖行' })
      const base = { id: 'naming-test', created: 1, model: 'naming-mock' }
      if (!input.stream) return Response.json({ ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 } })
      const chunks = [
        { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] },
        { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ]
      return new Response(`${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    } })
    try {
      process.env.AI_API_KEY = 'naming-test-dummy'
      process.env.AI_PROVIDER = 'compatible'
      process.env.AI_BASE_URL = `http://127.0.0.1:${mockServer.port}/v1`
      process.env.AI_MODEL = 'naming-mock'
      for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) process.env[key] = ''
      names.scheduleVersionName('owner', seeded.planId, seeded.version.id)
      for (let i = 0; i < 500 && read(seeded.version.id).nameSource !== 'ai'; i++) await Bun.sleep(20)
      assert.equal(requests, 1)
      assert.match(prompt, /灵隐寺/)
      assert.match(prompt, /parent/)
      assert.match(prompt, /changes/)
      assert.equal(read(seeded.version.id).name, '灵隐礼佛纳入西湖行')
      assert.equal(read(seeded.version.id).nameSource, 'ai')
    } finally { mockServer.stop(true) }
  },
}

try {
  const name = process.argv[2]!
  assert(cases[name], `Unknown case: ${name}`)
  await cases[name]!()
} finally { sqlite.close() }

import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import sharp from 'sharp'
import { createProductProviderFetch } from './mock-product-providers'
import { startProductModel } from './mock-product-ai'

const temporary = await mkdtemp(join(tmpdir(), 'verify-media-'))
process.env.DATABASE_URL = join(temporary, 'test-media.db')
process.env.AI_PROVIDER = 'deepseek'
process.env.AI_MODEL = 'deepseek-flash'
process.env.AI_API_KEY = process.env.TAVILY_API_KEY = process.env.BAIDU_MAP_AK = 'fixture-only'
const storage = new Map<string, unknown>()
Object.assign(globalThis, { useStorage: () => ({ getItem: async (key: string) => storage.get(key), setItem: async (key: string, value: unknown) => { storage.set(key, value) }, removeItem: async (key: string) => { storage.delete(key) } }) })
const originalFetch = globalThis.fetch
globalThis.fetch = createProductProviderFetch(originalFetch)
const { db } = await import('../server/utils/db')
const schema = await import('../server/database/schema')
try {
  if (process.argv.includes('--real')) {
    globalThis.fetch = originalFetch
    migrate(db, { migrationsFolder: resolve('server/database/migrations') })
    const { acquireWikimediaImage } = await import('../server/services/wikimedia')
    for (const entity of [{ entityId: 'spot:probe', entityType: 'spot' as const, name: '西湖', city: '杭州', address: '', fingerprint: 'probe' }, { entityId: 'food:probe', entityType: 'food' as const, name: '东坡肉', city: '杭州', address: '', fingerprint: 'probe' }]) {
      const started = Date.now()
      try {
        const result = await acquireWikimediaImage(entity)
        console.log(JSON.stringify({ mode: 'real-wikimedia', entity: entity.name, status: result ? 'image-fetched-and-decoded' : 'no-confirmed-image', source: result?.image.sourceUrl, attribution: result?.image.attribution, durationMs: Date.now() - started }))
      } catch (error) { console.log(JSON.stringify({ mode: 'real-wikimedia', entity: entity.name, status: 'unreachable-or-provider-error', errorType: error instanceof Error ? error.name : 'Error', contractIssues: error && typeof error === 'object' && 'issues' in error ? error.issues : undefined, durationMs: Date.now() - started })) }
    }
  } else {
  // Reproduce upgrade from the last released migration with existing user/plan data.
  const history = join(temporary, 'history')
  await mkdir(join(history, 'meta'), { recursive: true })
  const migrationRoot = resolve('server/database/migrations')
  const journal = JSON.parse(await readFile(join(migrationRoot, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> }
  journal.entries = journal.entries.filter(entry => entry.idx <= 2)
  await writeFile(join(history, 'meta/_journal.json'), JSON.stringify(journal))
  for (const entry of journal.entries) await copyFile(join(migrationRoot, `${entry.tag}.sql`), join(history, `${entry.tag}.sql`))
  migrate(db, { migrationsFolder: history })
  for (const id of ['owner', 'other']) db.insert(schema.user).values({ id, name: id, email: `${id}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() }).run()
  const oldPlan = db.insert(schema.plans).values({ userId: 'owner', title: '历史杭州', planJson: { title: '历史杭州', days: [{ city: '杭州', spots: [{ name: '西湖' }] }] } }).returning().get()
  const intermediate = join(temporary, 'intermediate')
  await mkdir(join(intermediate, 'meta'), { recursive: true })
  const initialJournal = JSON.parse(await readFile(join(migrationRoot, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> }
  initialJournal.entries = initialJournal.entries.filter(entry => entry.idx <= 3)
  await writeFile(join(intermediate, 'meta/_journal.json'), JSON.stringify(initialJournal))
  for (const entry of initialJournal.entries) await copyFile(join(migrationRoot, `${entry.tag}.sql`), join(intermediate, `${entry.tag}.sql`))
  migrate(db, { migrationsFolder: intermediate })
  const oldConversation = db.insert(schema.conversations).values({ userId: 'owner', planId: oldPlan.id }).returning().get()
  const oldMessage = db.insert(schema.messages).values({ conversationId: oldConversation.id, role: 'user', content: '旧附件历史' }).returning().get()
  const oldAttachmentId = crypto.randomUUID()
  db.insert(schema.attachments).values({ id: oldAttachmentId, userId: 'owner', planId: oldPlan.id, messageId: oldMessage.id, filename: 'historical.png', mediaType: 'image/png', size: 3, width: 1, height: 1, content: Buffer.from('old'), createdAt: new Date(0) }).run()
  migrate(db, { migrationsFolder: migrationRoot })
  assert.equal(db.select().from(schema.attachmentLinks).where(eq(schema.attachmentLinks.attachmentId, oldAttachmentId)).get()!.messageId, oldMessage.id, '0003 attachment references backfilled by 0005')
  assert.equal(db.select().from(schema.plans).where(eq(schema.plans.id, oldPlan.id)).get()!.title, '历史杭州')
  const { getPlanSnapshot, patchPlan, createPlan } = await import('../server/services/plan')
  const { getPlanResources, enrichPlanResources, readPlanResourceImage } = await import('../server/services/media')
  const { createAttachment, resolveAttachments, attachmentModelParts, bindAttachments, removeAttachment, maintainAttachments } = await import('../server/services/attachments')
  const { searchWeb } = await import('../server/providers/search')
  const { saveModelSettings, resolveModelConfiguration, getModelSettings } = await import('../server/services/model-settings')
  maintainAttachments()
  assert.equal(resolveAttachments('owner', oldPlan.id, [oldAttachmentId]).length, 1, 'Historical sent attachment is not orphaned after upgrade')
  const snapshot = await getPlanSnapshot('owner', oldPlan.id)
  assert.ok(snapshot.plan.days[0]!.spots[0]!.id)
  const resources = await enrichPlanResources('owner', oldPlan.id, snapshot.row.revision)
  assert.ok(resources.resources.some(resource => resource.image && resource.location && resource.status === 'ready'))
  const resource = resources.resources.find(item => item.image)!
  assert.match(resource.image!.url, /&v=[a-z0-9]+$/)
  assert.ok((await readPlanResourceImage('owner', oldPlan.id, resource.entityId)).byteLength > 0)
  await assert.rejects(() => readPlanResourceImage('owner', oldPlan.id, resource.entityId, 'staleidentity'), /暂不可用/)
  await assert.rejects(() => getPlanResources('other', oldPlan.id), /规划不存在/)
  await assert.rejects(() => readPlanResourceImage('other', oldPlan.id, resource.entityId), /规划不存在/)
  assert.equal((await getPlanSnapshot('owner', oldPlan.id)).row.revision, snapshot.row.revision, 'Resource updates cannot create plan revisions')
  const fixtureFetch = globalThis.fetch
  db.delete(schema.cache).run(); storage.clear()
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('zh.wikipedia.org')) throw new Error('Fixture image provider outage')
    return fixtureFetch(input, init)
  }, { preconnect: fixtureFetch.preconnect }) as typeof fetch
  const retried = await enrichPlanResources('owner', oldPlan.id, snapshot.row.revision, resource.entityId)
  const retainedImage = retried.resources.find(item => item.entityId === resource.entityId)!
  assert.equal(retainedImage.image?.sourceUrl, resource.image!.sourceUrl, 'Partial retry failure retains confirmed image')
  assert.ok(retainedImage.error)
  globalThis.fetch = fixtureFetch
  const { acquireWikimediaImage } = await import('../server/services/wikimedia')
  let attemptedPrivateFetch = false
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const address = String(input)
    if (address.includes('commons.wikimedia.org')) return Response.json({ query: { pages: { '1': { imageinfo: [{ url: 'http://127.0.0.1/private', descriptionurl: 'https://commons.wikimedia.org/wiki/File:fixture', extmetadata: { Artist: { value: 'fixture' }, LicenseShortName: { value: 'fixture' } } }] } } } })
    if (address.includes('127.0.0.1')) attemptedPrivateFetch = true
    return fixtureFetch(input, init)
  }, { preconnect: fixtureFetch.preconnect }) as typeof fetch
  assert.equal(await acquireWikimediaImage({ entityId: 'spot:ssrf', entityType: 'spot', name: '恶意来源测试', city: '杭州', address: '', fingerprint: 'ssrf' }), null)
  assert.equal(attemptedPrivateFetch, false, 'Untrusted media URL never reaches private network')
  globalThis.fetch = fixtureFetch
  // Slow completion must not overwrite a newer edit.
  let release!: () => void
  let reached!: () => void
  const started = new Promise<void>(done => { reached = done })
  const gate = new Promise<void>(done => { release = done })
  const providerFetch = globalThis.fetch
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('zh.wikipedia.org')) { reached(); await gate }
    return providerFetch(input, init)
  }, { preconnect: providerFetch.preconnect }) as typeof fetch
  await patchPlan('owner', oldPlan.id, { days: [{ city: '杭州', spots: [{ name: '断桥' }] }] }, { source: 'user', expectedRevision: snapshot.row.revision })
  const before = await getPlanSnapshot('owner', oldPlan.id)
  const job = enrichPlanResources('owner', oldPlan.id, before.row.revision)
  await started
  await patchPlan('owner', oldPlan.id, { summary: '后续编辑' }, { source: 'user', expectedRevision: before.row.revision })
  release()
  await assert.rejects(job, /已修改/)
  globalThis.fetch = providerFetch
  const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#ef4444' } }).png().toBuffer()
  const upload = await createAttachment('owner', oldPlan.id, 'menu.png', bytes)
  assert.equal(upload.mediaType, 'image/webp')
  assert.equal(upload.width, 12)
  await assert.rejects(() => createAttachment('owner', oldPlan.id, 'fake.png', Buffer.from('not an image')), /无法解码/)
  const otherPlan = await createPlan('other', { title: '其他用户' })
  assert.throws(() => resolveAttachments('other', otherPlan.planId, [upload.id]), /附件不存在/)
  const ownOtherPlan = await createPlan('owner', { title: '同用户另一工作区' })
  assert.throws(() => resolveAttachments('owner', ownOtherPlan.planId, [upload.id]), /附件不存在/)
  assert.match(attachmentModelParts('owner', oldPlan.id, [upload.id])[0]!.url, /^data:image\/webp;base64,/)
  const conversation = db.insert(schema.conversations).values({ userId: 'owner', planId: oldPlan.id }).returning().get()
  const first = db.insert(schema.messages).values({ conversationId: conversation.id, role: 'user' }).returning().get()
  const retry = db.insert(schema.messages).values({ conversationId: conversation.id, role: 'user' }).returning().get()
  db.transaction(tx => bindAttachments(tx, [upload.id], first.id, 'owner', oldPlan.id))
  db.transaction(tx => bindAttachments(tx, [upload.id], retry.id, 'owner', oldPlan.id))
  db.delete(schema.messages).where(eq(schema.messages.id, first.id)).run()
  db.update(schema.attachments).set({ createdAt: new Date(0) }).where(eq(schema.attachments.id, upload.id)).run()
  maintainAttachments()
  assert.equal(resolveAttachments('owner', oldPlan.id, [upload.id]).length, 1, 'Retry reference retains image')
  assert.throws(() => removeAttachment('owner', upload.id), /已发送附件/)
  db.delete(schema.messages).where(eq(schema.messages.id, retry.id)).run()
  maintainAttachments()
  assert.throws(() => resolveAttachments('owner', oldPlan.id, [upload.id]), /附件不存在/)
  const config = { model: 'deepseek-flash', webSearch: true, thinking: 'deep' as const }
  saveModelSettings('owner', config)
  assert.deepEqual(resolveModelConfiguration('owner'), config)
  process.env.AI_PROVIDER = 'compatible'; process.env.AI_MODEL = 'replacement'
  assert.equal(getModelSettings('owner').defaults.model, 'replacement')
  const sources = await searchWeb('杭州')
  assert.equal(sources[0]!.provider, 'Tavily')
  assert.match(sources[0]!.title, /本地测试/)
  const modelFixture = startProductModel()
  try {
    process.env.AI_PROVIDER = 'deepseek'; process.env.AI_MODEL = 'deepseek-flash'; process.env.AI_BASE_URL = modelFixture.baseURL
    const { createTravelMastra } = await import('../server/agents/travel-agent')
    const { handleChatStream } = await import('@mastra/ai-sdk')
    const image = await createAttachment('owner', oldPlan.id, 'vision.png', bytes)
    const current = await getPlanSnapshot('owner', oldPlan.id)
    const assistant = db.insert(schema.messages).values({ conversationId: conversation.id, role: 'assistant' }).returning().get()
    const mastra = createTravelMastra({ userId: 'owner', userName: '测试', planId: oldPlan.id, conversationId: conversation.id, assistantMessageId: assistant.id, plan: current.plan, version: current.current?.version ?? 1, revision: current.row.revision, agentsMd: '', configuration: { model: 'deepseek-flash', webSearch: false, thinking: 'deep' } })
    const stream = await handleChatStream({ mastra, agentId: 'travel-agent', version: 'v5', params: { messages: [{ id: 'image-test', role: 'user', parts: attachmentModelParts('owner', oldPlan.id, [image.id]) }], maxSteps: 4 } })
    const reader = stream.getReader(); let finished = false
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; if (value.type === 'error') throw new Error(value.errorText); if (value.type === 'finish') finished = true } } finally { reader.releaseLock() }
    assert(finished, 'Real Mastra image path must finish')
    assert(modelFixture.state.imageRequests >= 2, 'Provider received real inline image on tool roundtrip')
    assert(modelFixture.state.settings.every(setting => setting.effort === 'max'))
  } finally { modelFixture.server.stop(true) }
  console.log(JSON.stringify({ mode: 'isolated-provider-fixtures', passed: ['historical-migration', 'attachment-links-backfill', 'stable-ids', 'actual-image-decode', 'source-attribution', 'resource-scope', 'resource-cache-identity', 'partial-retry-preservation', 'media-ssrf-rejection', 'revision-preservation', 'stale-resource-rejection', 'attachment-format', 'attachment-scope', 'attachment-model-resolver', 'retry-reference', 'orphan-cleanup', 'defaults-persistence', 'configuration-change', 'search-source-contract', 'real-mastra-image-roundtrip'] }))
  }
} finally {
  globalThis.fetch = originalFetch
  db.$client.close()
  Bun.gc(true)
  assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + '\\') || resolve(temporary).startsWith(resolve(tmpdir()) + '/'))
  await rm(temporary, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 })
}

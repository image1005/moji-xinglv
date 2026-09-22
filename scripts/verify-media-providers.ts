import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import sharp from 'sharp'
import { createProductProviderFetch } from './mock-product-providers'
import { startProductModel } from './mock-product-ai'
import type { PlanEntity } from '../shared/utils/plan-entities'

const temporary = await mkdtemp(join(tmpdir(), 'verify-media-'))
process.env.DATABASE_URL = join(temporary, 'test-media.db')
process.env.AI_PROVIDER = 'deepseek'
process.env.AI_MODEL = 'deepseek-flash'
process.env.AI_API_KEY = process.env.TAVILY_API_KEY = process.env.BAIDU_MAP_AK = 'fixture-only'
if (!process.argv.includes('--real')) process.env.MEDIA_IMAGE_SEARCH = 'off'
const storage = new Map<string, unknown>()
Object.assign(globalThis, { useStorage: () => ({ getItem: async (key: string) => storage.get(key), setItem: async (key: string, value: unknown) => { storage.set(key, value) }, removeItem: async (key: string) => { storage.delete(key) } }) })
const originalFetch = globalThis.fetch
globalThis.fetch = createProductProviderFetch(originalFetch)
const { db } = await import('../server/utils/db')
const schema = await import('../server/database/schema')
try {
  if (process.argv.includes('--real') && process.argv.includes('--tencent')) {
    globalThis.fetch = originalFetch
    migrate(db, { migrationsFolder: resolve('server/database/migrations') })
    process.env.MEDIA_IMAGE_SEARCH = 'tencent'
    const { searchTencentImages } = await import('../server/providers/tencent-images')
    const { getResourceImageBytes, trustedImageOrigin } = await import('../server/services/media-image')
    const { mentionsMediaSubject } = await import('../server/providers/media-identity')
    try {
      const candidates = await searchTencentImages('太原 晋祠 实景')
      let confirmed = false
      for (const candidate of candidates.filter(item => item.title.includes('太原') && mentionsMediaSubject(item.title, '晋祠')).slice(0, 3)) {
        const url = new URL(candidate.thumbnailUrl)
        if (url.protocol === 'http:') url.protocol = 'https:'
        if (!trustedImageOrigin(url.href)) continue
        try {
          await getResourceImageBytes(url.href, `tencent-probe:${url.href}`)
          confirmed = true
          console.log(JSON.stringify({ mode: 'real-tencent', status: 'image-fetched-and-decoded', title: candidate.title, source: candidate.siteUrl }))
          break
        } catch { /* Try at most three documented CDN candidates. */ }
      }
      if (!confirmed) { process.exitCode = 1; console.log(JSON.stringify({ mode: 'real-tencent', status: 'no-confirmed-image', candidateCount: candidates.length })) }
    } catch (error) {
      const { imageFailure } = await import('../server/providers/media-errors')
      process.exitCode = 1
      console.log(JSON.stringify({ mode: 'real-tencent', status: 'not-verified', ...imageFailure(error) }))
    }
  } else if (process.argv.includes('--real')) {
    globalThis.fetch = originalFetch
    migrate(db, { migrationsFolder: resolve('server/database/migrations') })
    const { acquireWikimediaImage } = await import('../server/services/wikimedia')
    const samples: Array<[PlanEntity['entityType'], string, string]> = process.argv.includes('--coverage') ? [
      ['city', '太原（晋源区）', '太原（晋源区）'], ['spot', '晋祠', '太原（晋源区）'],
      ['spot', '天龙山石窟', '太原（晋源区）'], ['spot', '纯阳宫', '太原'], ['spot', '永祚寺（双塔寺）', '太原'],
      ['spot', '钟楼街·柳巷', '太原'], ['food', '过油肉', '太原'], ['food', '头脑（配帽盒、黄酒）', '太原'],
    ] : [['spot', '苏州拙政园', '苏州'], ['food', '东坡肉', '杭州']]
    for (const [entityType, name, city] of samples) {
      const entity: PlanEntity = { entityId: `${entityType}:probe`, entityType, name, city, address: '', fingerprint: 'probe' }
      const started = Date.now()
      try {
        const result = await acquireWikimediaImage(entity)
        if (!result) process.exitCode = 1
        console.log(JSON.stringify({ mode: 'real-wikimedia', entity: entity.name, status: result ? 'image-fetched-and-decoded' : 'no-confirmed-image', matchedName: result?.image.matchedName, source: result?.image.sourceUrl, attribution: result?.image.attribution, durationMs: Date.now() - started }))
      } catch (error) { process.exitCode = 1; console.log(JSON.stringify({ mode: 'real-wikimedia', entity: entity.name, status: 'unreachable-or-provider-error', errorType: error instanceof Error ? error.name : 'Error', contractIssues: error && typeof error === 'object' && 'issues' in error ? error.issues : undefined, durationMs: Date.now() - started })) }
    }
  } else {
  // Exercise the official SDK under the actual Bun runtime, using only loopback and dummy keys.
  const { wimgs } = await import('tencentcloud-sdk-nodejs-wimgs')
  let signedSdkRequest = false
  const sdkServer = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    signedSdkRequest = request.headers.get('authorization')?.startsWith('TC3-HMAC-SHA256') === true
      && request.headers.get('x-tc-action') === 'SearchByText' && request.headers.get('x-tc-version') === '2025-11-06'
      && (await request.json() as { Query: string }).Query === 'fixture-only'
    return Response.json({ Response: { Images: [], RequestId: 'fixture-only' } })
  } })
  try {
    const client = new wimgs.v20251106.Client({ credential: { secretId: 'fixture-only', secretKey: 'fixture-only' }, profile: { httpProfile: { endpoint: `127.0.0.1:${sdkServer.port}`, protocol: 'http://', reqTimeout: 3 } } })
    assert.deepEqual((await client.request('SearchByText', { Query: 'fixture-only' }, { signal: AbortSignal.timeout(3000) })).Images, [])
    assert(signedSdkRequest, 'Official SDK signs and serializes requests under Bun')
    console.log(JSON.stringify({ mode: 'isolated-tencent-sdk', status: 'signed-request-and-response-passed', runtime: `Bun ${Bun.version}` }))
  } finally { sdkServer.stop(true) }
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
  assert.match(resource.image!.url, /&v=[a-z0-9]+&image=[a-f0-9]{64}$/)
  assert.ok((await readPlanResourceImage('owner', oldPlan.id, resource.entityId)).byteLength > 0)
  const initialRow = db.select().from(schema.planResources).where(eq(schema.planResources.entityId, resource.entityId)).get()!
  const imageCacheKey = initialRow.imageCacheKey!
  const binaryRow = db.select().from(schema.cache).where(eq(schema.cache.key, `bin:${imageCacheKey}`)).get()!
  assert(binaryRow.expiresAt.getTime() > Date.now() + 6 * 86400_000, 'Server image TTL is seven days')
  storage.clear()
  const originalProviderFetch = globalThis.fetch
  globalThis.fetch = Object.assign(async () => { throw new Error('No network allowed during persistent-cache check') }, { preconnect: originalProviderFetch.preconnect }) as typeof fetch
  try {
    assert.deepEqual(await readPlanResourceImage('owner', oldPlan.id, resource.entityId, initialRow.fingerprint, imageCacheKey), Buffer.from(binaryRow.value), 'Cold L1 must refill from SQLite without downloading')
    await assert.rejects(() => readPlanResourceImage('other', oldPlan.id, resource.entityId, initialRow.fingerprint, imageCacheKey), /规划不存在/, 'Cache hit cannot bypass ownership')
    const newKey = 'a'.repeat(64)
    db.update(schema.planResources).set({ imageCacheKey: newKey }).where(eq(schema.planResources.id, initialRow.id)).run()
    const changed = (await getPlanResources('owner', oldPlan.id)).resources.find(item => item.entityId === resource.entityId)!
    assert.notEqual(changed.image!.url, resource.image!.url, 'Replacing image changes frontend cache identity without a plan revision')
    await assert.rejects(() => readPlanResourceImage('owner', oldPlan.id, resource.entityId, initialRow.fingerprint, imageCacheKey), /暂不可用/, 'Old image identity cannot read replacement')
  } finally {
    globalThis.fetch = originalProviderFetch
    db.update(schema.planResources).set({ imageCacheKey }).where(eq(schema.planResources.id, initialRow.id)).run()
  }
  console.log(JSON.stringify({ mode: 'isolated-image-cache', passed: ['seven-day-ttl', 'sqlite-cold-read-no-network', 'cache-hit-ownership', 'replacement-url-version', 'stale-image-rejection'] }))
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
  assert.deepEqual(resolveModelConfiguration('owner'), { ...config, searchProvider: 'Tavily' })
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

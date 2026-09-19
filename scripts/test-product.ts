/** Production app, temporary database and explicitly simulated external providers. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { chromium, expect, type Browser, type Page } from '@playwright/test'
import sharp from 'sharp'
import { startProductModel } from './mock-product-ai'
import type { PlanDetail } from '../shared/schemas/workspace'
import type { PlanResources } from '../shared/schemas/media'
import type { Attachment } from '../shared/schemas/attachment'

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) process.env[key] = ''
process.env.NO_PROXY = process.env.no_proxy = 'localhost,127.0.0.1'
const temporaryRoot = realpathSync(tmpdir())
const directory = mkdtempSync(join(temporaryRoot, 'shanhai-product-test-'))
const reportDirectory = resolve('.verification/product', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(reportDirectory, { recursive: true })
const mock = startProductModel()
const port = await new Promise<number>((resolvePort, reject) => {
  const probe = createServer(); probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => { const address = probe.address(); assert(address && typeof address !== 'string'); probe.close(error => error ? reject(error) : resolvePort(address.port)) })
})
const origin = `http://127.0.0.1:${port}`
const env = {
  ...process.env, NODE_ENV: 'production', DATABASE_URL: `file:${join(directory, 'product.db').replaceAll('\\', '/')}`,
  AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(), BETTER_AUTH_URL: origin,
  AI_PROVIDER: 'deepseek', AI_MODEL: 'deepseek-flash', AI_API_KEY: 'fixture-only', AI_BASE_URL: mock.baseURL,
  TAVILY_API_KEY: 'fixture-only', BAIDU_MAP_AK: 'fixture-only', PRODUCT_MOCK_PROVIDERS: '1',
  NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), HOST: '127.0.0.1', PORT: String(port),
}
const steps: string[] = [], pageErrors: string[] = [], wire: { type: string; binary: boolean }[] = []
let browser: Browser | undefined, page: Page | undefined, server: ReturnType<typeof Bun.spawn> | undefined
let stdout: Promise<string> | undefined, stderr: Promise<string> | undefined
let passed = false, planId = 0, conversationId = 0, attachmentId = '', failResourceReads = true
async function step(name: string, run: () => Promise<void>) { await run(); steps.push(name); console.log(`[product] ${name}: passed`) }
async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await page!.request.fetch(`${origin}${path}`, { method, data, headers: { origin } })
  assert(response.ok(), `${path}: ${response.status()} ${(await response.text()).slice(0, 400)}`)
  return response.json() as Promise<T>
}
async function openChat() {
  const folder = page!.locator('.folder').filter({ has: page!.locator('.folder__title', { hasText: '图文产品验收' }) })
  await expect(folder).toBeVisible()
  if (await folder.locator('.folder__toggle').getAttribute('aria-expanded') !== 'true') await folder.locator('.folder__toggle').click()
  await folder.locator('.conversation-row .row').first().click()
  await page!.getByRole('tab', { name: '旅途对话', exact: true }).click()
  await expect(page!.locator('#travel-message')).toBeVisible()
}
try {
  await step('迁移独立数据库并启动生产服务', async () => {
    const migration = Bun.spawn([process.execPath, 'run', 'server/database/migrate.ts'], { env, stdout: 'pipe', stderr: 'pipe' })
    assert.equal(await migration.exited, 0, await new Response(migration.stderr).text())
    const launched = Bun.spawn([process.execPath, '--preload', './scripts/mock-providers-preload.ts', '.output/server/index.mjs'], { env, stdout: 'pipe', stderr: 'pipe' })
    server = launched
    stdout = new Response(launched.stdout).text(); stderr = new Response(launched.stderr).text()
    let ready = false
    for (let i = 0; i < 100; i++) {
      assert(server.exitCode === null, '生产服务提前退出')
      try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch { /* bounded startup */ }
      await Bun.sleep(100)
    }
    assert(ready)
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('request', request => { if (request.url().endsWith('/api/chat') && request.method() === 'POST') wire.push({ type: request.headers()['content-type'] ?? '', binary: (request.postData() ?? '').includes('base64') }) })
    await page.route('**/*', route => new URL(route.request().url()).origin === origin || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort())
    await page.route('**/resource-image?*', route => failResourceReads ? route.fulfill({ status: 503, body: 'explicit local image failure fixture' }) : route.continue())
    await api('/api/auth/sign-up/email', 'POST', { email: `${crypto.randomUUID()}@example.invalid`, password: crypto.randomUUID() + 'Aa9!', name: '产品隔离测试' })
    planId = (await api<{ planId: number }>('/api/plans', 'POST', { title: '图文产品验收' })).planId
    conversationId = (await api<{ id: number }>('/api/conversations', 'POST', { planId })).id
    await page.goto(origin)
    await openChat()
  })
  await step('真实文件上传的失败重试、纯图片发送及搜索深度参数', async () => {
    await expect(page!.getByLabel('思考深度')).toBeEnabled()
    await page!.getByLabel('思考深度').selectOption('deep')
    await page!.getByLabel('联网搜索', { exact: true }).check()
    let failOnce = true
    await page!.route('**/api/attachments', async route => {
      if (route.request().method() === 'POST' && failOnce) { failOnce = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ statusMessage: '隔离测试：模拟首次上传失败' }) }) }
      else await route.continue()
    })
    const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c74b3e' } }).png().toBuffer()
    await page!.getByLabel('选择旅行图片').setInputFiles({ name: '景点照片-测试.png', mimeType: 'image/png', buffer })
    await expect(page!.locator('.composer__attachment').getByRole('button', { name: '重试', exact: true })).toBeVisible()
    const upload = page!.waitForResponse(response => response.url().endsWith('/api/attachments') && response.status() === 200)
    await page!.locator('.composer__attachment').getByRole('button', { name: '重试', exact: true }).click()
    attachmentId = ((await (await upload).json()) as Attachment).id
    await expect(page!.locator('.composer__attachment')).toContainText('已上传')
    await expect(page!.locator('#travel-message')).toHaveValue('')
    await page!.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect.poll(async () => (await api<{ status: string }[]>(`/api/chat/runs?conversationId=${conversationId}`))[0]?.status, { timeout: 45000 }).toBe('completed')
    await expect(page!.locator('.chat-message')).toContainText(['隔离模拟模型完成'])
    assert(mock.state.imageRequests > 0)
    assert.equal(mock.state.searches, 1)
    assert(mock.state.settings.some(value => value.effort === 'max'))
    assert(wire.length > 0 && wire.every(value => value.type.includes('application/x-ndjson') && !value.binary))
    const plan = await api<PlanDetail>(`/api/plans/${planId}`)
    assert.equal(plan.plan.days[0]?.spots.length, 2)
    assert.equal(plan.plan.foodJournal.length, 1)
    assert(plan.plan.days[0]!.spots.every(spot => spot.id))
    assert.equal(plan.version, 2, '一轮工具编辑仅提交一个版本')
  })
  await step('景点食记图片和城市地图逐步补齐，不改变行程版本', async () => {
    const before = await api<PlanDetail>(`/api/plans/${planId}`)
    const folder = page!.locator('.folder').filter({ has: page!.locator('.folder__title', { hasText: '图文产品验收' }) })
    await folder.locator('.row--plan').click()
    await page!.getByRole('tab', { name: '行程总览', exact: true }).click()
    await expect.poll(async () => (await api<PlanResources>(`/api/plans/${planId}/resources`)).resources.filter(value => value.image && value.location).length, { timeout: 45000 }).toBeGreaterThanOrEqual(3)
    const resources = await api<PlanResources>(`/api/plans/${planId}/resources`)
    assert(resources.resources.some(value => value.entityType === 'spot' && value.image?.kind === 'place_photo'))
    assert(resources.resources.some(value => value.entityType === 'food' && value.image?.kind === 'food_illustration'))
    assert(resources.resources.every(value => !value.image || Boolean(value.image.sourceUrl && value.image.attribution)))
    const after = await api<PlanDetail>(`/api/plans/${planId}`)
    assert.equal(after.version, before.version); assert.equal(after.revision, before.revision)
    const firstImage = page!.locator('.resource-image').first()
    await firstImage.scrollIntoViewIfNeeded()
    await expect(firstImage.getByRole('button', { name: '重试', exact: true })).toBeVisible()
    failResourceReads = false
    await firstImage.getByRole('button', { name: '重试', exact: true }).click()
    await expect(firstImage.locator('img')).toBeVisible()
    await page!.reload()
    await folder.locator('.row--plan').click()
    await page!.getByRole('tab', { name: '行程总览', exact: true }).click()
    await page!.getByLabel('地图每日路线').selectOption('0')
    const map = page!.getByRole('region', { name: '目标城市地图' })
    await map.scrollIntoViewIfNeeded()
    await expect.poll(async () => map.locator('img').evaluateAll(images => images.some(image => (image as unknown as { naturalWidth: number }).naturalWidth > 0)), { timeout: 20000 }).toBe(true)
    await page!.screenshot({ path: join(reportDirectory, 'illustrated-itinerary.png'), fullPage: true, animations: 'disabled' })
  })
  await step('编辑保存、刷新恢复图片历史并继续图片追问', async () => {
    const before = await api<PlanDetail>(`/api/plans/${planId}`)
    await api(`/api/plans/${planId}`, 'PATCH', { summary: '人工编辑已保存', expectedRevision: before.revision, expectedVersion: before.version })
    await page!.reload(); await openChat()
    await expect(page!.locator('.chat-message img').first()).toBeVisible()
    await expect(page!.getByLabel('思考深度')).toHaveValue('deep')
    await page!.getByLabel('联网搜索', { exact: true }).uncheck()
    await page!.getByLabel('思考深度').selectOption('light')
    const searchCount = mock.state.searches
    await page!.locator('#travel-message').fill('根据刚才菜单截图调整行程')
    await page!.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect.poll(async () => (await api<PlanDetail>(`/api/plans/${planId}`)).plan.summary, { timeout: 45000 }).toContain('1 张上下文图片')
    await expect.poll(async () => (await api<{ status: string }[]>(`/api/chat/runs?conversationId=${conversationId}`))[0]?.status).toBe('completed')
    assert.equal(mock.state.searches, searchCount, '关闭联网不会执行搜索')
    assert(mock.state.settings.some(value => value.effort === 'low'))
    await page!.getByRole('button', { name: '保存行笺', exact: true }).click()
    await page!.reload(); await openChat()
    await expect(page!.locator('.chat-message img').first()).toBeVisible()
    await page!.screenshot({ path: join(reportDirectory, 'restored-image-history.png'), fullPage: true, animations: 'disabled' })
  })
  await step('浏览器取消生成并刷新恢复已保存内容', async () => {
    const before = await api<PlanDetail>(`/api/plans/${planId}`)
    await page!.locator('#travel-message').fill('取消验收：请开始一段生成')
    await page!.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect(page!.getByText('隔离取消验收正在生成', { exact: true })).toBeVisible()
    await page!.getByRole('button', { name: '停止生成', exact: true }).click()
    await expect.poll(async () => (await api<{ status: string }[]>(`/api/chat/runs?conversationId=${conversationId}`))[0]?.status).toBe('cancelled')
    const after = await api<PlanDetail>(`/api/plans/${planId}`)
    assert.equal(after.version, before.version); assert.equal(after.revision, before.revision)
    await page!.reload(); await openChat()
    await expect(page!.locator('.chat-message')).toContainText(['生成已停止'])
    await expect(page!.locator('.chat-message img').first()).toBeVisible()
  })
  await step('跨工作区与跨用户附件访问被拒绝，伪图片被真实解码拒绝', async () => {
    const otherPlan = await api<{ planId: number }>('/api/plans', 'POST', { title: '其他工作区' })
    const otherConversation = await api<{ id: number }>('/api/conversations', 'POST', { planId: otherPlan.planId })
    const input = { protocolVersion: 1, type: 'message', requestId: crypto.randomUUID(), messageId: 'image-scope', planId: otherPlan.planId, conversationId: otherConversation.id, message: { id: 'image-scope', role: 'user', parts: [{ type: 'file', attachmentId }] } }
    const denied = await page!.request.post(`${origin}/api/chat`, { headers: { origin, 'content-type': 'application/x-ndjson' }, data: `${JSON.stringify(input)}\n` })
    assert.equal(denied.status(), 404)
    const fake = await page!.request.post(`${origin}/api/attachments`, { headers: { origin }, multipart: { planId: String(planId), file: { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not an image') } } })
    assert.equal(fake.status(), 400)
    const otherContext = await browser!.newContext()
    const register = await otherContext.request.post(`${origin}/api/auth/sign-up/email`, { headers: { origin }, data: { email: `${crypto.randomUUID()}@example.invalid`, password: crypto.randomUUID() + 'Aa9!', name: '其他用户' } })
    assert(register.ok())
    assert.equal((await otherContext.request.get(`${origin}/api/attachments/${attachmentId}`)).status(), 404)
    assert.equal((await otherContext.request.get(`${origin}/api/plans/${planId}/resources`)).status(), 404)
    await otherContext.close()
  })
  assert.deepEqual(pageErrors, [])
  passed = true
} catch (error) {
  process.exitCode = 1
  console.error(`[product] FAILED: ${error instanceof Error ? error.message : String(error)}`)
  await page?.screenshot({ path: join(reportDirectory, 'failure.png'), fullPage: true }).catch(() => {})
} finally {
  await browser?.close(); server?.kill(); if (server) await server.exited
  mock.server.stop(true)
  writeFileSync(join(reportDirectory, 'report.json'), JSON.stringify({ passed, steps, pageErrors, wire, model: mock.state, scope: '真实生产构建/浏览器/SQLite/工具；图片、地图、搜索及模型为显式隔离fixture，非真实供应商验收' }, null, 2))
  if (stdout) writeFileSync(join(reportDirectory, 'server.log'), await stdout)
  if (stderr) writeFileSync(join(reportDirectory, 'server-errors.log'), await stderr)
  const checked = realpathSync(directory), segment = relative(temporaryRoot, checked)
  assert(segment && segment !== '..' && !segment.startsWith(`..${sep}`) && resolve(temporaryRoot, segment) === checked)
  rmSync(checked, { recursive: true })
  console.log(`[product] report: ${join(reportDirectory, 'report.json')}`)
}

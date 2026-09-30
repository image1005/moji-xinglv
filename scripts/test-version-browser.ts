/** Real production UI/HTTP + temporary SQLite. Only pending name API and AI provider use explicit fixtures. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { chromium, expect, type Browser, type Locator, type Page } from '@playwright/test'
import { PlanSchema } from '../shared/schemas/plan'
import type { PlanDetail, VersionItem } from '../shared/schemas/workspace'
import { startProductModel } from './mock-product-ai'

assert(existsSync('.output/server/index.mjs'), 'Run bun run build first')
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) process.env[key] = ''
process.env.NO_PROXY = process.env.no_proxy = 'localhost,127.0.0.1'
const temporaryRoot = realpathSync(tmpdir())
const temporary = mkdtempSync(join(temporaryRoot, 'shanhai-version-browser-'))
const artifacts = resolve('.verification/versions', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(artifacts, { recursive: true })
const mock = startProductModel()
const port = await new Promise<number>((done, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address()
    assert(address && typeof address !== 'string')
    probe.close(error => error ? reject(error) : done(address.port))
  })
})
const origin = `http://127.0.0.1:${port}`
const env = {
  ...process.env, NODE_ENV: 'production', DATABASE_URL: `file:${join(temporary, 'versions.db').replaceAll('\\', '/')}`,
  AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(), BETTER_AUTH_URL: origin,
  AI_PROVIDER: 'deepseek', AI_MODEL: 'deepseek-flash', AI_API_KEY: 'isolated-fixture', AI_BASE_URL: mock.baseURL,
  TAVILY_API_KEY: '', BAIDU_MAP_AK: '',
  NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), HOST: '127.0.0.1', PORT: String(port),
}
type NamedVersion = VersionItem & { name: string | null; nameSource: 'ai' | 'user' | 'fallback' | null; nameRevision: number }
const names = new Map<number, Pick<NamedVersion, 'name' | 'nameSource' | 'nameRevision'>>()
const steps: { name: string; status: 'passed' | 'failed'; error?: string }[] = []
const pageErrors: string[] = []
const mutations: string[] = []
const snapshotRequests: Record<string, number> = {}
const measurements: Record<string, unknown> = {}
let browser: Browser | undefined, page: Page | undefined, server: ReturnType<typeof Bun.spawn> | undefined
let stdout: Promise<string> | undefined, stderr: Promise<string> | undefined
let planId = 0, otherId = 0, conversationId = 0, passed = false, renameFailure = 0, nameFixtureEnabled = false
const title = '山海版本验收 · 江南行笺'
const otherTitle = '另一个工作区 · 隔离核验'
const richPlan = PlanSchema.parse({
  title, summary: '第一版专属历史摘要：西湖听雨，姑苏寻味。',
  days: [{ date: '2026-10-01', city: '杭州', spots: [{ name: '历史独有：断桥残雪', address: '杭州市西湖区北山街', time: '09:00', notes: '漫步湖畔', cost: 30 }], lodging: '湖畔客栈历史住宿', transport: '高铁与公交历史交通', meals: ['午餐：东坡肉'] }],
  budget: { total: 3200, currency: 'CNY', breakdown: { 住宿: 1200, 交通: 800, 餐食: 600, 门票: 600 } },
  foodJournal: [{ id: 'food-1', name: '历史东坡肉', restaurant: '楼外楼', city: '杭州', address: '孤山路', date: '2026-10-01', meal: 'lunch', status: 'tasted', cost: 88, rating: 5, notes: '入口软糯' }],
  tips: ['记得携伞'], checklist: [{ id: 'ticket', text: '确认车票', done: true }], tags: ['江南', '慢游'],
})
async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await page!.request.fetch(`${origin}${path}`, { method, data, headers: { origin } })
  assert(response.ok(), `${method} ${path}: ${response.status()} ${(await response.text()).slice(0, 400)}`)
  return response.json() as Promise<T>
}
const detail = () => api<PlanDetail>(`/api/plans/${planId}`)
const list = () => api<VersionItem[]>(`/api/plans/${planId}/versions`)
async function snapshotState() {
  const current = await detail()
  return { version: current.version, revision: current.revision, count: (await list()).length }
}
async function step(name: string, run: () => Promise<void>) {
  try { await run(); steps.push({ name, status: 'passed' }); console.log(`[versions] ${name}: passed`) }
  catch (error) { steps.push({ name, status: 'failed', error: String(error) }); throw error }
}
async function folder(label = title) {
  const drawer = page!.getByRole('button', { name: '打开行笺导航', exact: true })
  if (await drawer.isVisible() && await drawer.getAttribute('aria-expanded') !== 'true') await drawer.click()
  const value = page!.locator('.folder').filter({ has: page!.locator('.folder__title', { hasText: label }) })
  await expect(value).toBeVisible()
  if (await value.locator('.folder__toggle').getAttribute('aria-expanded') !== 'true') await value.locator('.folder__toggle').click()
  return value
}
async function openRoadmap(label = title) {
  await (await folder(label)).locator('.conversation-row .row').first().click()
  await page!.getByRole('tab', { name: '版本路线', exact: true }).click()
  await expect(page!.locator('.roadmap__svg')).toBeVisible()
}
const svg = () => page!.locator('.roadmap__svg')
const dialog = () => page!.getByRole('dialog')
async function openVersion(version: number) {
  const target = page!.locator(`.roadmap__node[data-version="${version}"]`)
  // Keyboard activation remains reliable for nodes outside the currently zoomed viewport.
  await target.focus()
  await target.press('Enter')
  await expect(dialog()).toBeVisible()
}
async function closePreview() { await page!.keyboard.press('Escape'); await expect(dialog()).toHaveCount(0) }
async function coordinates(target: Locator) {
  return target.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
}
async function dragAndMeasure(label: string, point: { x: number; y: number }, dx: number, dy: number) {
  const first = page!.locator('.roadmap__node').first()
  const before = await coordinates(first)
  await page!.mouse.move(point.x, point.y); await page!.mouse.down()
  await page!.mouse.move(point.x + dx, point.y + dy, { steps: 8 }); await page!.mouse.up()
  const after = await coordinates(first)
  const delta = { x: after.x - before.x, y: after.y - before.y }
  measurements[label] = { expected: { x: dx, y: dy }, actual: delta }
  assert(Math.abs(delta.x - dx) < 1.5 && Math.abs(delta.y - dy) < 1.5, `${label}: ${JSON.stringify(delta)}`)
  await expect(dialog()).toHaveCount(0)
}
try {
  await step('生产构建、临时数据库、真实鉴权与历史版本准备', async () => {
    const migration = Bun.spawn([process.execPath, 'run', 'server/database/migrate.ts'], { env, stdout: 'pipe', stderr: 'pipe' })
    assert.equal(await migration.exited, 0, await new Response(migration.stderr).text())
    const launched = Bun.spawn([process.execPath, '.output/server/index.mjs'], { env, stdout: 'pipe', stderr: 'pipe' })
    server = launched
    stdout = new Response(launched.stdout).text(); stderr = new Response(launched.stderr).text()
    let ready = false
    for (let i = 0; i < 100; i++) {
      assert(server.exitCode === null, 'Production server stopped')
      try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch { /* bounded startup */ }
      await Bun.sleep(100)
    }
    assert(ready)
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, hasTouch: true })
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path.includes('/api/plans/') && request.method() !== 'GET') mutations.push(`${request.method()} ${path}`)
      if (/\/versions\/\d+$/.test(path)) snapshotRequests[path] = (snapshotRequests[path] ?? 0) + 1
    })
    await page.route('**/*', route => new URL(route.request().url()).origin === origin || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort())
    await api('/api/auth/sign-up/email', 'POST', { email: `${crypto.randomUUID()}@example.invalid`, password: crypto.randomUUID() + 'Aa9!', name: '版本隔离验收' })
    planId = (await api<{ planId: number }>('/api/plans', 'POST', { title, planJson: richPlan })).planId
    conversationId = (await api<{ id: number }>('/api/conversations', 'POST', { planId })).id
    for (let n = 2; n <= 56; n++) {
      const current = await detail()
      await api(`/api/plans/${planId}/save`, 'POST', { planJson: { ...current.plan, summary: `真实历史快照第 ${n} 版` }, expectedVersion: current.version, expectedRevision: current.revision })
    }
    for (let n = 0; n < 10; n++) {
      const current = await detail()
      await api(`/api/plans/${planId}/switch`, 'POST', { version: 20, expectedVersion: current.version, expectedRevision: current.revision })
      const switched = await detail()
      await api(`/api/plans/${planId}/save`, 'POST', { planJson: { ...switched.plan, summary: `宽分叉独立方案 ${n + 1}` }, expectedVersion: switched.version, expectedRevision: switched.revision })
    }
    otherId = (await api<{ planId: number }>('/api/plans', 'POST', { title: otherTitle })).planId
    await api('/api/conversations', 'POST', { planId: otherId })
    const all = await list()
    for (const item of all) names.set(item.id, { name: item.version === 1 ? '江南烟雨初稿' : item.version === 66 ? '沿西湖望姑苏缓缓行走记录风物与四季烟火的长名称版本' : null, nameSource: item.version === 1 ? 'ai' : item.version === 66 ? 'user' : null, nameRevision: 0 })
    // Pending backend contract: metadata fixture is confined to this test process.
    await page.route('**/api/plans/*/versions?*', async route => {
      const response = await route.fetch()
      const body = await response.json() as { items: VersionItem[] }
      await route.fulfill({ response, json: { ...body, items: body.items.map(item => ({ ...item, ...names.get(item.id) })) } })
    })
    await page.route('**/api/plans/*/versions/*/name', async route => {
      if (!nameFixtureEnabled) { await route.continue(); return }
      if (renameFailure) { await route.fulfill({ status: renameFailure, json: { statusCode: renameFailure, statusMessage: renameFailure === 409 ? '名称已由其他窗口修改，请刷新后重试' : '隔离测试：名称保存暂时失败' } }); return }
      const match = /\/plans\/(\d+)\/versions\/(\d+)\/name$/.exec(new URL(route.request().url()).pathname)!
      assert.equal(Number(match[1]), planId)
      const version = all.find(item => item.version === Number(match[2]))!
      assert(version)
      const body = route.request().postDataJSON() as { name: string; expectedNameRevision: number }
      const previous = names.get(version.id)!
      assert.equal(body.expectedNameRevision, previous.nameRevision)
      assert(body.name.length >= 1 && body.name.length <= 40 && body.name === body.name.trim())
      const metadata = { name: body.name, nameSource: 'user' as const, nameRevision: previous.nameRevision + 1 }
      names.set(version.id, metadata)
      await route.fulfill({ json: { version: { ...version, ...metadata } } })
    })
    await page.goto(origin); await openRoadmap()
    await expect(page!.locator('.roadmap__node')).toHaveCount(50)
  })
  await step('分页补历史保留镜头，长树与宽分叉适应全部节点', async () => {
    await expect(page!.getByText(/父版本未加载/).first()).toBeVisible()
    await page!.getByRole('button', { name: '放大', exact: true }).click()
    const current = page!.locator('.roadmap__node--current')
    const before = await coordinates(current), canvasBefore = await coordinates(svg())
    await page!.getByRole('button', { name: '加载更早的版本', exact: true }).click()
    await expect(page!.locator('.roadmap__node')).toHaveCount(66)
    const after = await coordinates(current), canvasAfter = await coordinates(svg())
    measurements.historyAppend = { before, after, canvasBefore, canvasAfter }
    assert(Math.abs((before.x - canvasBefore.x) - (after.x - canvasAfter.x)) < 2 && Math.abs((before.y - canvasBefore.y) - (after.y - canvasAfter.y)) < 2, 'History append changed camera')
    assert(Math.abs(canvasBefore.y - canvasAfter.y) < 1, 'History controls collapsing moved the canvas')
    assert(Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1, 'History append moved an existing node on screen')
    await page!.getByRole('button', { name: /适应/ }).click()
    const bounds = await coordinates(svg())
    const rectangles = await page!.locator('.roadmap__node').evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }))
    assert(rectangles.every(r => r.left >= bounds.x - 1 && r.right <= bounds.x + bounds.width + 1 && r.top >= bounds.y - 1 && r.bottom <= bounds.y + bounds.height + 1))
    await page!.screenshot({ path: join(artifacts, 'wide-long-tree.png'), fullPage: true, animations: 'disabled' })
  })
  await step('实际 SVG 矩阵：背景/连线平移、鼠标定点缩放与画布外释放', async () => {
    const box = await coordinates(svg())
    await dragAndMeasure('background', { x: box.x + 20, y: box.y + 80 }, 100, 60)
    // Chromium's input pipeline rounds wheel pointer coordinates to CSS pixels.
    const anchor = { x: Math.round(box.x + box.width * 0.2), y: Math.round(box.y + box.height * 0.35) }
    const read = () => svg().evaluate((element, point) => {
      const p = new DOMPoint(point.x, point.y).matrixTransform((element as unknown as { getScreenCTM(): DOMMatrix }).getScreenCTM().inverse())
      return { x: p.x, y: p.y }
    }, anchor)
    const before = await read()
    await page!.mouse.move(anchor.x, anchor.y); await page!.mouse.wheel(0, -220)
    await page!.waitForTimeout(80)
    const after = await read()
    measurements.zoomAnchor = { before, after }
    assert(Math.abs(before.x - after.x) < 0.02 && Math.abs(before.y - after.y) < 0.02, 'Mouse zoom anchor moved')
    await dragAndMeasure('zoomed-background', { x: box.x + 20, y: box.y + 80 }, 80, 40)
    await page!.getByRole('button', { name: /适应/ }).click()
    const point = await page!.locator('.roadmap__edge').first().evaluate(element => {
      const path = element as unknown as { getPointAtLength(length: number): DOMPoint; getTotalLength(): number; getScreenCTM(): DOMMatrix }
      const p = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM()!)
      return { x: p.x, y: p.y }
    })
    await dragAndMeasure('edge', point, -70, 40)
    await dragAndMeasure('outside-release', { x: box.x + 10, y: box.y + 100 }, -70, -120)
    const released = await svg().getAttribute('viewBox')
    await page!.mouse.move(box.x + 300, box.y + 180)
    assert.equal(await svg().getAttribute('viewBox'), released, 'Released pointer still pans')
    await expect(page!.locator('.roadmap__canvas--dragging')).toHaveCount(0)
    await page!.getByRole('button', { name: /定位当前/ }).click()
    const current = await coordinates(page!.locator('.roadmap__node--current'))
    assert(current.x >= box.x && current.x + current.width <= box.x + box.width)
    await dragAndMeasure('node-drag-does-not-preview', { x: current.x + current.width / 2, y: current.y + current.height / 2 }, 40, 25)
    await page!.locator('.roadmap__node--current').click()
    await expect(dialog()).toBeVisible(); await closePreview()
    await svg().focus(); const keyboardBefore = await svg().getAttribute('viewBox'); await page!.keyboard.press('ArrowRight')
    assert.notEqual(await svg().getAttribute('viewBox'), keyboardBefore)
    await page!.screenshot({ path: join(artifacts, 'current-version.png'), fullPage: true, animations: 'disabled' })
  })
  await step('历史真实快照只读展示、焦点约束与零写入', async () => {
    const before = await snapshotState(), writes = mutations.length
    const reads = snapshotRequests[`/api/plans/${planId}/versions/1`] ?? 0
    await openVersion(1)
    await expect(dialog()).toContainText(richPlan.summary)
    for (const text of ['历史独有：断桥残雪', '湖畔客栈历史住宿', '高铁与公交历史交通', '历史东坡肉', '楼外楼', '3,200']) await expect(dialog()).toContainText(text)
    await expect(dialog()).not.toContainText('宽分叉独立方案 10')
    for (let n = 0; n < 18; n++) { await page!.keyboard.press('Tab'); assert(await dialog().evaluate(element => element.contains(element.ownerDocument.activeElement)), 'Focus escaped preview') }
    assert.equal(snapshotRequests[`/api/plans/${planId}/versions/1`], reads + 1, 'Metadata merge restarted the snapshot request')
    await page!.screenshot({ path: join(artifacts, 'historical-preview.png'), fullPage: true, animations: 'disabled' })
    await closePreview()
    assert(await page!.locator('.roadmap__node').evaluateAll(elements => elements.includes(elements[0]!.ownerDocument.activeElement!)))
    assert.deepEqual(await snapshotState(), before)
    assert.equal(mutations.length, writes)
  })
  await step('连续选择与关闭旧请求：最后选择快照胜出，失败重试与空数据', async () => {
    let slow = true
    await page!.route(`**/api/plans/${planId}/versions/2`, async route => { const response = await route.fetch(); if (slow) await Bun.sleep(700); await route.fulfill({ response }) })
    await openVersion(2); await closePreview(); await openVersion(3)
    await expect(dialog()).toContainText('真实历史快照第 3 版')
    await page!.waitForTimeout(850)
    await expect(dialog()).toContainText('真实历史快照第 3 版')
    await expect(dialog()).not.toContainText('真实历史快照第 2 版')
    await closePreview(); slow = false
    let failed = true
    await page!.route(`**/api/plans/${planId}/versions/4`, route => failed ? route.fulfill({ status: 503, json: { statusMessage: '历史暂时不可用' } }) : route.continue())
    await openVersion(4); await expect(dialog().getByRole('button', { name: '重试加载快照', exact: true })).toBeVisible()
    failed = false; await dialog().getByRole('button', { name: '重试加载快照', exact: true }).click(); await expect(dialog()).toContainText('真实历史快照第 4 版'); await closePreview()
    await page!.route(`**/api/plans/${planId}/versions/5`, route => route.fulfill({ json: { plan: null } }))
    await openVersion(5); await expect(dialog()).toContainText(/暂无|空/); await closePreview()
    slow = true; await openVersion(2); await closePreview(); await openRoadmap(otherTitle)
    await page!.waitForTimeout(850); await expect(dialog()).toHaveCount(0); await expect(page!.locator('.roadmap__node')).toHaveCount(1)
    await openRoadmap(); await page!.getByRole('button', { name: '加载更早的版本', exact: true }).click(); await expect(page!.locator('.roadmap__node')).toHaveCount(66)
  })
  await step('后端命名端点尚未合并时真实请求失败，输入仍保留', async () => {
    await openVersion(1)
    await dialog().getByRole('button', { name: '修改版本名称', exact: true }).click()
    await dialog().getByLabel('版本名称', { exact: true }).fill('后端未合并时保留这份输入')
    const response = page!.waitForResponse(value => value.url().endsWith(`/versions/1/name`) && value.request().method() === 'PATCH')
    await dialog().getByRole('button', { name: '保存名称', exact: true }).click()
    const result = await response
    assert(!result.ok(), 'Pending endpoint unexpectedly exists; update fixture assumptions')
    measurements.pendingBackend = { status: result.status(), contract: 'PATCH /api/plans/:id/versions/:version/name' }
    await expect(dialog().getByRole('alert')).toBeVisible()
    await expect(dialog().getByLabel('版本名称', { exact: true })).toHaveValue('后端未合并时保留这份输入')
    await closePreview()
    nameFixtureEnabled = true
  })
  await step('历史改名独立提交、错误保留输入、409 刷新与刷新后持久显示', async () => {
    const before = await snapshotState()
    await openVersion(1)
    await dialog().getByRole('button', { name: '修改版本名称', exact: true }).click()
    const input = dialog().getByRole('textbox')
    await input.fill('   ')
    await expect(dialog().getByRole('button', { name: '保存名称', exact: true })).toBeDisabled()
    await input.fill('江'.repeat(41))
    await expect(dialog().getByRole('button', { name: '保存名称', exact: true })).toBeDisabled()
    await dialog().getByRole('button', { name: '取消改名', exact: true }).click()
    await expect(dialog()).toContainText('江南烟雨初稿')
    await dialog().getByRole('button', { name: '修改版本名称', exact: true }).click()
    await input.fill('  烟雨江南 · 留存初稿  ')
    renameFailure = 503
    await dialog().getByRole('button', { name: /保存名称/ }).click()
    await expect(dialog()).toContainText('名称保存暂时失败')
    await expect(input).toHaveValue('  烟雨江南 · 留存初稿  ')
    renameFailure = 409
    const original = (await list()).find(item => item.version === 1)!
    names.set(original.id, { name: '其他窗口已改名', nameSource: 'user', nameRevision: 1 })
    await dialog().getByRole('button', { name: /保存名称/ }).click()
    await expect(dialog()).toContainText(/冲突|其他窗口/)
    await expect(input).toHaveValue('  烟雨江南 · 留存初稿  ')
    await dialog().getByRole('button', { name: '读取最新名称', exact: true }).click()
    await expect(dialog()).toContainText('其他窗口已改名')
    await expect(input).toHaveValue('  烟雨江南 · 留存初稿  ')
    renameFailure = 0
    await dialog().getByRole('button', { name: '以我的名称重新提交', exact: true }).click()
    await expect(dialog()).toContainText('烟雨江南 · 留存初稿')
    assert.deepEqual(await snapshotState(), before, 'Rename changed plan version/revision or node count')
    await page!.screenshot({ path: join(artifacts, 'renamed-history.png'), fullPage: true, animations: 'disabled' })
    await closePreview(); await page!.reload(); await openRoadmap()
    await page!.getByRole('button', { name: '加载更早的版本', exact: true }).click(); await expect(page!.locator('.roadmap__node')).toHaveCount(66)
    await openVersion(1); await expect(dialog()).toContainText('烟雨江南 · 留存初稿'); await closePreview()
  })
  await step('窄屏真实触摸平移、双指缩放、取消与长名称布局', async () => {
    await page!.setViewportSize({ width: 390, height: 844 }); await openRoadmap()
    await page!.getByRole('button', { name: /定位当前/ }).click()
    assert(await page!.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Narrow page overflows')
    const box = await coordinates(svg()), client = await page!.context().newCDPSession(page!)
    const first = page!.locator('.roadmap__node').first(), before = await coordinates(first)
    const touch = (x: number, y: number, id = 1) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 })
    const p = { x: box.x + 20, y: box.y + box.height / 2 }
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(p.x, p.y)] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(p.x + 55, p.y + 35)] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const after = await coordinates(first)
    measurements.touch = { x: after.x - before.x, y: after.y - before.y }
    assert(Math.abs(after.x - before.x - 55) < 2 && Math.abs(after.y - before.y - 35) < 2)
    await expect(dialog()).toHaveCount(0)
    const priorZoom = await svg().getAttribute('viewBox')
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(x - 25, y, 1), touch(x + 25, y, 2)] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(x - 55, y, 1), touch(x + 55, y, 2)] })
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    assert.notEqual(await svg().getAttribute('viewBox'), priorZoom)
    await expect(page!.locator('.roadmap__canvas--dragging')).toHaveCount(0)
    await page!.screenshot({ path: join(artifacts, 'narrow-touch-tree.png'), fullPage: true, animations: 'disabled' })
    await openVersion(66); await expect(dialog()).toContainText('沿西湖望姑苏缓缓行走记录风物与四季烟火的长名称版本')
    assert(await dialog().evaluate(element => element.scrollWidth <= element.clientWidth + 1))
    await page!.screenshot({ path: join(artifacts, 'narrow-long-name-preview.png'), fullPage: true, animations: 'disabled' }); await closePreview()
    await client.detach(); await page!.setViewportSize({ width: 1440, height: 1080 })
  })
  await step('显式切换继续受真实 revision 冲突保护', async () => {
    await openVersion(1)
    const stale = await detail()
    await api(`/api/plans/${planId}`, 'PATCH', { summary: '其他窗口的并发真实编辑', expectedVersion: stale.version, expectedRevision: stale.revision })
    const updated = await snapshotState()
    page!.once('dialog', prompt => prompt.accept())
    const response = page!.waitForResponse(value => value.url().endsWith(`/plans/${planId}/switch`))
    await dialog().getByRole('button', { name: '切换到此版本', exact: true }).click()
    assert.equal((await response).status(), 409)
    await expect(dialog()).toContainText('版本冲突')
    assert.deepEqual(await snapshotState(), updated)
    await closePreview(); await page!.reload(); await openRoadmap()
    await page!.getByRole('button', { name: '加载更早的版本', exact: true }).click()
    await expect(page!.locator('.roadmap__node')).toHaveCount(updated.count)
  })
  await step('明确切换历史版后表单草稿恢复并保存，正确产生分叉', async () => {
    const before = await snapshotState()
    await openVersion(1)
    page!.once('dialog', prompt => prompt.accept())
    await dialog().getByRole('button', { name: '切换到此版本', exact: true }).click()
    await expect.poll(async () => (await detail()).version).toBe(1)
    assert.equal((await list()).length, before.count)
    if (await dialog().count()) await closePreview()
    await (await folder()).locator('.row--plan').click(); await page!.getByRole('tab', { name: '行程总览', exact: true }).click()
    await page!.getByRole('button', { name: '编辑资料', exact: true }).click()
    await page!.getByLabel('旅程简介').fill('历史分叉后的有效表单保存与草稿恢复')
    await page!.reload(); await (await folder()).locator('.row--plan').click()
    await expect(page!.getByLabel('旅程简介')).toHaveValue('历史分叉后的有效表单保存与草稿恢复')
    await page!.getByRole('button', { name: '保存资料', exact: true }).click()
    await expect(page!.getByText('行笺资料已保存。', { exact: true })).toBeVisible()
    const result = await detail(), versions = await list()
    assert.equal(result.version, before.count + 1)
    assert.equal(versions.find(item => item.version === result.version)?.parentVersionId, versions.find(item => item.version === 1)?.id)
    await page!.screenshot({ path: join(artifacts, 'branch-edit-saved.png'), fullPage: true, animations: 'disabled' })
  })
  await step('冗余保存入口消失，AI 结构化编辑与预览仍然可用', async () => {
    await (await folder()).locator('.conversation-row .row').first().click(); await page!.getByRole('tab', { name: '旅途对话', exact: true }).click()
    await expect(page!.getByRole('button', { name: /保存当前行程为新版本|保存行笺/ })).toHaveCount(0)
    const before = await snapshotState()
    await page!.locator('#travel-message').fill('请调整这个历史分叉行程，保留第一版风格')
    await page!.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect.poll(async () => (await api<{ status: string }[]>(`/api/chat/runs?conversationId=${conversationId}`))[0]?.status, { timeout: 45000 }).toBe('completed')
    assert(mock.state.edits > 0)
    const after = await snapshotState()
    assert.equal(after.count, before.count + 1)
    await expect(page!.locator('.preview-card').first()).toBeVisible()
    await expect(page!.locator('.preview-card').getByRole('button', { name: /保存/ })).toHaveCount(0)
    await page!.screenshot({ path: join(artifacts, 'ai-generated-preview.png'), fullPage: true, animations: 'disabled' })
  })
  assert.deepEqual(pageErrors, [])
  passed = true
} catch (error) {
  process.exitCode = 1
  console.error(`[versions] FAILED: ${error instanceof Error ? error.stack : String(error)}`)
  await page?.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
} finally {
  await page?.unrouteAll({ behavior: 'ignoreErrors' }); await browser?.close(); server?.kill(); if (server) await server.exited
  mock.server.stop(true)
  writeFileSync(join(artifacts, 'report.json'), JSON.stringify({ passed, steps, pageErrors, measurements, mutations, snapshotRequests, model: mock.state, scope: 'Real production Vue UI, Chromium mouse/touch/keyboard, real temporary SQLite, authentication, historical GET, version switch and form saves. Version naming metadata/PATCH are explicit Playwright fixtures pending backend merge; AI is loopback SSE fixture.' }, null, 2))
  if (stdout) writeFileSync(join(artifacts, 'server.log'), await stdout)
  if (stderr) writeFileSync(join(artifacts, 'server-errors.log'), await stderr)
  const checked = realpathSync(temporary), segment = relative(temporaryRoot, checked)
  assert(segment && segment !== '..' && !segment.startsWith(`..${sep}`) && resolve(temporaryRoot, segment) === checked)
  rmSync(checked, { recursive: true })
  console.log(`[versions] report: ${join(artifacts, 'report.json')}`)
}

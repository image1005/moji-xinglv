/** Production browser + isolated SQLite. Baidu SDK, basemap and location resources are explicit fixtures. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { chromium, expect, type Browser, type Locator, type Page } from '@playwright/test'
import sharp from 'sharp'
import { PlanSchema } from '../shared/schemas/plan'
import type { PlanResources } from '../shared/schemas/media'
import type { PlanDetail, VersionItem } from '../shared/schemas/workspace'
import { baiduBrowserFixture, type BaiduBrowserFixtureState } from './mock-baidu-browser'
import { startProductModel } from './mock-product-ai'

assert(existsSync('.output/server/index.mjs'), 'Run bun run build first')
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) process.env[key] = ''
process.env.NO_PROXY = process.env.no_proxy = 'localhost,127.0.0.1'
const temporaryRoot = realpathSync(tmpdir())
const temporary = mkdtempSync(join(temporaryRoot, 'shanhai-city-map-test-'))
const artifacts = resolve('.verification/city-map', new Date().toISOString().replace(/[:.]/g, '-'))
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
  ...process.env, NODE_ENV: 'production', DATABASE_URL: `file:${join(temporary, 'city-map.db').replaceAll('\\', '/')}`,
  AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(), BETTER_AUTH_URL: origin,
  AI_PROVIDER: 'deepseek', AI_MODEL: 'deepseek-flash', AI_API_KEY: 'fixture-only', AI_BASE_URL: mock.baseURL,
  TAVILY_API_KEY: 'fixture-only', BAIDU_MAP_AK: 'fixture-only', PRODUCT_MOCK_PROVIDERS: '1',
  NUXT_PUBLIC_BAIDU_MAP_BROWSER_AK: 'fixture-browser-only',
  NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), HOST: '127.0.0.1', PORT: String(port),
}
const title = '城市地图交互隔离验收'
const fixturePlan = PlanSchema.parse({
  title,
  days: [
    { date: '2026-10-01', city: '杭州', spots: [
      { id: 'unknown', name: '未定位第一站' },
      { id: 'shared-first', name: '西湖同址早访', lng: 120.1, lat: 30.21 },
      ...Array.from({ length: 11 }, (_, index) => ({
        id: `lake-${index + 1}`, name: `沿湖第 ${index + 3} 站`, address: `测试杭州湖畔路 ${index + 3} 号`, time: `${String(10 + index).padStart(2, '0')}:00`,
        lng: 120.1 + ((index + 1) % 4) * 0.012, lat: 30.21 + Math.floor((index + 1) / 4) * 0.014,
      })),
    ] },
    { date: '2026-10-02', city: '苏州', spots: [{ id: 'suzhou-first', name: '苏州第一站', lng: 120.63, lat: 31.32 }, { id: 'suzhou-second', name: '苏州第二站', lng: 120.64, lat: 31.33 }] },
    { date: '2026-10-03', city: '杭州', spots: [{ id: 'shared-again', name: '西湖同址晚访', lng: 120.1, lat: 30.21 }, { id: 'evening', name: '杭州夜游', lng: 120.15, lat: 30.235 }] },
  ],
})
const imageBytes = await sharp({ create: { width: 800, height: 480, channels: 3, background: '#e8ebe2' } }).png().toBuffer()
const steps: Array<{ name: string; status: 'passed' | 'failed'; error?: string }> = []
const measurements: Record<string, unknown> = {}
const pageErrors: string[] = [], externalRequests: string[] = [], mutations: string[] = []
let browser: Browser | undefined, page: Page | undefined, server: ReturnType<typeof Bun.spawn> | undefined
let stdout: Promise<string> | undefined, stderr: Promise<string> | undefined
let planId = 0, fixtureRevision = 1, passed = false, failSdk = false, sdkRequests = 0, staticRequests = 0

async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await page!.request.fetch(`${origin}${path}`, { method, data, headers: { origin } })
  assert(response.ok(), `${method} ${path}: ${response.status()} ${(await response.text()).slice(0, 400)}`)
  return response.json() as Promise<T>
}
async function state() {
  const detail = await api<PlanDetail>(`/api/plans/${planId}`)
  const versions = await api<VersionItem[]>(`/api/plans/${planId}/versions`)
  return { revision: detail.revision, version: detail.version, versions: versions.length }
}
async function sdkState() {
  return page!.evaluate(() => (globalThis as unknown as { __baiduFixture: BaiduBrowserFixtureState }).__baiduFixture)
}
async function step(name: string, work: () => Promise<void>) {
  try { await work(); steps.push({ name, status: 'passed' }); console.log(`[city-map] ${name}: passed`) }
  catch (error) { steps.push({ name, status: 'failed', error: String(error) }); throw error }
}
const cityMap = () => page!.getByRole('region', { name: '目标城市地图', exact: true })
const map = () => cityMap().locator('.interactive-map')
const viewport = () => map().locator('.interactive-map__viewport')
const places = () => cityMap().locator('.city-map__place')
const place = (name: string) => places().filter({ hasText: name })
async function rect(target: Locator) {
  const box = await target.boundingBox()
  assert(box, 'Expected visible element with a bounding box')
  return box
}
async function openCityMap() {
  const drawer = page!.getByRole('button', { name: '打开行笺导航', exact: true })
  if (await drawer.isVisible() && await drawer.getAttribute('aria-expanded') !== 'true') await drawer.click()
  const folder = page!.locator('.folder').filter({ has: page!.locator('.folder__title', { hasText: title }) })
  await expect(folder).toBeVisible()
  if (await folder.locator('.folder__toggle').getAttribute('aria-expanded') !== 'true') await folder.locator('.folder__toggle').click()
  await folder.locator('.row--plan').click()
  await page!.getByRole('tab', { name: '行程总览', exact: true }).click()
  await cityMap().scrollIntoViewIfNeeded()
}
function resourceFixtures(): PlanResources {
  return {
    revision: fixtureRevision,
    resources: fixturePlan.days.flatMap(day => day.spots.map(spot => ({
      entityId: `spot:${spot.id}`, entityType: 'spot' as const, name: spot.name, city: day.city,
      status: spot.lng === null ? 'not_found' as const : 'ready' as const,
      image: { url: '/__city-map-fixture-image.png', sourceUrl: 'https://example.org/city-map-fixture', provider: '显式隔离测试图片', attribution: '非真实地点照片', kind: 'place_photo' as const },
      location: spot.lng === null || spot.lat === null ? null : { lng: spot.lng, lat: spot.lat, coordinateSystem: 'bd09ll' as const, provider: '显式隔离测试坐标', sourceUrl: 'https://example.org/city-map-fixture' },
      error: null,
    }))),
  }
}
let before: Awaited<ReturnType<typeof state>> | undefined
try {
  await step('临时 SQLite、真实鉴权、生产页面与显式 SDK 测试响应', async () => {
    const migration = Bun.spawn([process.execPath, 'run', 'server/database/migrate.ts'], { env, stdout: 'pipe', stderr: 'pipe' })
    assert.equal(await migration.exited, 0, await new Response(migration.stderr).text())
    const launched = Bun.spawn([process.execPath, '--preload', './scripts/mock-providers-preload.ts', '.output/server/index.mjs'], { env, stdout: 'pipe', stderr: 'pipe' })
    server = launched
    stdout = new Response(launched.stdout).text(); stderr = new Response(launched.stderr).text()
    let ready = false
    for (let i = 0; i < 100; i++) {
      assert(server.exitCode === null, 'Production server stopped')
      try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch { /* bounded startup */ }
      await Bun.sleep(100)
    }
    assert(ready)
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined })
    page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, hasTouch: true })
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.origin === origin && /^\/api\/plans\/\d+(?:\/save|\/switch)?$/.test(url.pathname) && request.method() !== 'GET') mutations.push(`${request.method()} ${url.pathname}`)
    })
    await page.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.hostname === 'api.map.baidu.com' && url.pathname === '/api') {
        sdkRequests++
        assert.equal(url.searchParams.get('ak'), 'fixture-browser-only')
        if (failSdk) { await route.fulfill({ status: 503, body: 'Explicit isolated SDK failure' }); return }
        const callback = url.searchParams.get('callback')
        assert(callback, 'SDK loader must use the official callback parameter')
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: baiduBrowserFixture(callback) })
        return
      }
      if (url.origin === origin) {
        if (/^\/api\/plans\/\d+\/resources$/.test(url.pathname)) { await route.fulfill({ json: resourceFixtures() }); return }
        if (url.pathname === '/__city-map-fixture-image.png' || url.pathname === '/api/staticmap') {
          if (url.pathname === '/api/staticmap') staticRequests++
          await route.fulfill({ status: 200, contentType: 'image/png', body: imageBytes }); return
        }
        await route.continue(); return
      }
      if (/^(data|blob):/.test(url.href)) { await route.continue(); return }
      externalRequests.push(`${url.protocol}//${url.host}${url.pathname}`)
      await route.abort()
    })
    await api('/api/auth/sign-up/email', 'POST', { email: `${crypto.randomUUID()}@example.invalid`, password: crypto.randomUUID() + 'Aa9!', name: '地图隔离验收' })
    planId = (await api<{ planId: number }>('/api/plans', 'POST', { title, planJson: fixturePlan })).planId
    await api('/api/conversations', 'POST', { planId })
    before = await state(); fixtureRevision = before.revision; mutations.length = 0
    await page.goto(origin); await openCityMap()
    await expect(map()).toHaveAttribute('data-state', 'ready', { timeout: 20000 })
    const sdk = (await sdkState()).maps.at(-1)
    assert(sdk)
    assert(sdk.dragging && sdk.scrollWheel && sdk.pinch && sdk.doubleClick, 'Map gestures must be enabled on the SDK')
    assert.equal(sdkRequests, 1)
  })
  await step('大标记、原站点编号以及超过 10 处的完整清单', async () => {
    await expect(places()).toHaveCount(15)
    await expect(place('未定位第一站')).toContainText('1')
    await expect(place('未定位第一站')).toContainText('待定位')
    const previousCenter = (await sdkState()).maps.at(-1)!.center
    await place('未定位第一站').click()
    await expect(cityMap().locator('.city-map__selection')).toContainText('此地点尚无可信坐标')
    assert.deepEqual((await sdkState()).maps.at(-1)!.center, previousCenter)
    await expect(map().locator('.interactive-map__marker')).not.toHaveCount(0)
    const sizes = await map().locator('.interactive-map__marker').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect(); return { width: box.width, height: box.height }
    }))
    assert(sizes.every(size => size.width >= 36 && size.height >= 36), 'Marker hit areas must be at least 36px')
    measurements.markerSizes = sizes
    await place('沿湖第 13 站').click()
    await expect(place('沿湖第 13 站')).toHaveAttribute('aria-pressed', 'true')
    await expect(map().getByRole('button', { name: '第 1 日 · 第 13 站 · 沿湖第 13 站', exact: true })).toBeVisible()
  })
  await step('重叠地点可逐项选择，跨天同址不会丢失', async () => {
    await map().getByRole('button', { name: '查看全部地点', exact: true }).click()
    const overlap = map().getByRole('button', { name: '此处 2 项行程，点击展开', exact: true })
    await overlap.click()
    await map().getByRole('group', { name: '重叠地点', exact: true }).getByRole('button', { name: /第 3 日.*1.*西湖同址晚访/ }).click()
    await expect(place('西湖同址晚访')).toHaveAttribute('aria-pressed', 'true')
    await expect(place('西湖同址早访')).toHaveAttribute('aria-pressed', 'false')
    await map().getByRole('button', { name: '查看全部地点', exact: true }).click()
    await overlap.click()
    await map().getByRole('group', { name: '重叠地点', exact: true }).getByRole('button', { name: /第 1 日.*2.*西湖同址早访/ }).click()
    await expect(place('西湖同址早访')).toHaveAttribute('aria-pressed', 'true')
  })
  await step('每日路线和城市切换保持正确站点与原日索引', async () => {
    await page!.getByLabel('地图每日路线', { exact: true }).selectOption('2')
    await expect(places()).toHaveCount(2)
    await expect(place('西湖同址晚访')).toBeVisible()
    await page!.getByLabel('地图每日路线', { exact: true }).selectOption('0')
    await expect(places()).toHaveCount(13)
    await expect(place('西湖同址晚访')).toHaveCount(0)
    await page!.getByLabel('地图城市', { exact: true }).selectOption('苏州')
    await expect(places()).toHaveCount(2)
    await expect(place('苏州第一站')).toBeVisible()
    await expect(place('西湖同址早访')).toHaveCount(0)
    await page!.getByLabel('地图城市', { exact: true }).selectOption('杭州')
    await expect(places()).toHaveCount(15)
    await page!.getByLabel('地图每日路线', { exact: true }).selectOption('0')
    await expect(places()).toHaveCount(13)
  })
  await step('鼠标拖动让地图中心与 DOM 标点一起移动', async () => {
    await map().getByRole('button', { name: '查看全部地点', exact: true }).click()
    await viewport().scrollIntoViewIfNeeded()
    const target = map().getByRole('button', { name: '第 1 日 · 第 3 站 · 沿湖第 3 站', exact: true })
    const initial = await rect(target)
    const box = await rect(viewport())
    const sdkBefore = (await sdkState()).maps.at(-1)!
    await page!.mouse.move(box.x + 20, box.y + box.height * 0.5)
    await page!.mouse.down()
    await page!.mouse.move(box.x + 100, box.y + box.height * 0.5 + 30, { steps: 8 })
    await page!.mouse.up()
    await expect.poll(async () => (await sdkState()).maps.at(-1)!.drags).toBeGreaterThan(sdkBefore.drags)
    await expect.poll(async () => Math.round((await rect(target)).x - initial.x)).toBe(80)
    await expect.poll(async () => Math.round((await rect(target)).y - initial.y)).toBe(30)
    const sdkAfter = (await sdkState()).maps.at(-1)!
    assert.notDeepEqual(sdkAfter.center, sdkBefore.center)
    measurements.drag = { expected: { x: 80, y: 30 }, actual: { x: (await rect(target)).x - initial.x, y: (await rect(target)).y - initial.y } }
  })
  await step('滚轮、缩放按钮与查看全部地点驱动真实界面状态', async () => {
    const box = await rect(viewport())
    const initial = Number(await viewport().getAttribute('data-zoom'))
    assert(Number.isFinite(initial) && initial > 0)
    await page!.mouse.move(box.x + 25, box.y + 25)
    await page!.mouse.wheel(0, -120)
    await expect(viewport()).toHaveAttribute('data-zoom', String(initial + 1))
    assert((await sdkState()).maps.at(-1)!.wheels > 0)
    await map().getByRole('button', { name: '放大地图', exact: true }).click()
    await expect(viewport()).toHaveAttribute('data-zoom', String(initial + 2))
    await map().getByRole('button', { name: '缩小地图', exact: true }).click()
    await expect(viewport()).toHaveAttribute('data-zoom', String(initial + 1))
    const fitCalls = (await sdkState()).maps.at(-1)!.viewportCalls
    await map().getByRole('button', { name: '查看全部地点', exact: true }).click()
    await expect.poll(async () => (await sdkState()).maps.at(-1)!.viewportCalls).toBeGreaterThan(fitCalls)
    await expect(map().locator('.interactive-map__marker')).toHaveCount(12)
    await cityMap().screenshot({ path: join(artifacts, 'desktop-city-map.png'), animations: 'disabled' })
  })
  await step('再次选择同一地点重新聚焦，切换页签恢复选中地点', async () => {
    await map().getByRole('button', { name: '第 1 日 · 第 3 站 · 沿湖第 3 站', exact: true }).click()
    await expect(place('沿湖第 3 站')).toHaveAttribute('aria-pressed', 'true')
    await place('沿湖第 13 站').click()
    const focused = (await sdkState()).maps.at(-1)!.center
    await viewport().press('ArrowRight')
    await expect.poll(async () => (await sdkState()).maps.at(-1)!.center.lng).not.toBe(focused.lng)
    await place('沿湖第 13 站').click()
    await expect.poll(async () => (await sdkState()).maps.at(-1)!.center).toEqual(focused)
    const mapCount = (await sdkState()).maps.length
    await page!.getByRole('tab', { name: '路线舆图', exact: true }).click()
    await expect.poll(async () => (await sdkState()).maps.at(-1)!.destroyed).toBe(true)
    await page!.getByRole('tab', { name: '行程总览', exact: true }).click()
    await cityMap().scrollIntoViewIfNeeded()
    await expect(map()).toHaveAttribute('data-state', 'ready')
    await expect.poll(async () => (await sdkState()).maps.length).toBe(mapCount + 1)
    await expect(page!.getByLabel('地图每日路线', { exact: true })).toHaveValue('0')
    await expect(place('沿湖第 13 站')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await sdkState()).maps.at(-1)!.center).toEqual(focused)
    await expect(map().getByRole('button', { name: '第 1 日 · 第 13 站 · 沿湖第 13 站', exact: true })).toHaveClass(/is-selected/)
    assert.equal(sdkRequests, 1, 'KeepAlive activation must reuse the already-loaded SDK')
  })
  await step('移动端地图、工具与地点清单不横向溢出', async () => {
    await page!.setViewportSize({ width: 390, height: 844 })
    await viewport().scrollIntoViewIfNeeded()
    await map().getByRole('button', { name: '查看全部地点', exact: true }).click()
    const box = await rect(map())
    assert(box.x >= -1 && box.x + box.width <= 391)
    const layout = await page!.evaluate(() => {
      const browserWindow = globalThis as unknown as { innerWidth: number; document: { documentElement: { scrollWidth: number } } }
      return { width: browserWindow.innerWidth, scrollWidth: browserWindow.document.documentElement.scrollWidth }
    })
    assert(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout))
    await expect(place('沿湖第 13 站')).toBeEnabled()
    await place('沿湖第 13 站').click()
    await expect(place('沿湖第 13 站')).toHaveAttribute('aria-pressed', 'true')
    measurements.mobile = { map: box, document: layout }
    await cityMap().screenshot({ path: join(artifacts, 'mobile-city-map.png'), animations: 'disabled' })
  })
  await step('SDK 加载错误保留静态图与地点清单', async () => {
    failSdk = true
    await page!.setViewportSize({ width: 1440, height: 1080 })
    await page!.reload(); await openCityMap()
    await expect(map()).toHaveAttribute('data-state', 'error', { timeout: 20000 })
    await expect(places()).toHaveCount(15)
    await expect.poll(async () => cityMap().locator('img').evaluateAll(images => images.some(image => image.naturalWidth > 0))).toBe(true)
    assert(staticRequests > 0, 'SDK failure must retain a static map fallback')
    await cityMap().screenshot({ path: join(artifacts, 'sdk-error-fallback.png'), animations: 'disabled' })
  })
  await step('全部地图浏览操作不修改规划、修订号或正式版本', async () => {
    assert.deepEqual(await state(), before)
    assert.deepEqual(mutations, [])
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(externalRequests, [])
  })
  passed = true
} catch (error) {
  process.exitCode = 1
  console.error(`[city-map] FAILED: ${error instanceof Error ? error.message : String(error)}`)
  await page?.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
} finally {
  await browser?.close(); server?.kill(); if (server) await server.exited
  mock.server.stop(true)
  writeFileSync(join(artifacts, 'report.json'), JSON.stringify({
    passed, steps, measurements, sdkRequests, staticRequests, pageErrors, externalRequests, mutations,
    scope: '真实生产构建、浏览器事件、界面、鉴权与临时 SQLite；百度 SDK、底图、定位资源及模型为显式隔离 fixture，不代表真实百度服务或地图准确度验收',
  }, null, 2))
  if (stdout) writeFileSync(join(artifacts, 'server.log'), await stdout)
  if (stderr) writeFileSync(join(artifacts, 'server-errors.log'), await stderr)
  const checked = realpathSync(temporary), segment = relative(temporaryRoot, checked)
  assert(segment && segment !== '..' && !segment.startsWith(`..${sep}`) && resolve(temporaryRoot, segment) === checked)
  rmSync(checked, { recursive: true })
  console.log(`[city-map] report: ${join(artifacts, 'report.json')}`)
}

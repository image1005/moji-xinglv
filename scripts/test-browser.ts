/** 生产产物 + 临时 SQLite + 回环 SSE 模型的浏览器验收。运行前先 bun run build。 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { chromium, expect, type Browser, type Locator, type Page } from '@playwright/test'
import { startMockAi } from './mock-ai'

const project = process.cwd()
assert.ok(existsSync(join(project, '.output/server/index.mjs')), '请先执行 bun run build，浏览器验收只使用生产产物')
for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) process.env[name] = ''
process.env.NO_PROXY = process.env.no_proxy = 'localhost,127.0.0.1'
const temporaryRoot = realpathSync(tmpdir())
const temporaryDirectory = mkdtempSync(join(temporaryRoot, 'shanhai-browser-'))
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const artifacts = resolve(project, '.verification/browser', runId)
mkdirSync(artifacts, { recursive: true })
const mock = startMockAi()
const port = await new Promise<number>((resolvePort, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address()
    if (!address || typeof address === 'string') { reject(new Error('无法分配测试端口')); return }
    probe.close((error) => error ? reject(error) : resolvePort(address.port))
  })
})
const origin = `http://127.0.0.1:${port}`
const env = {
  ...process.env, NODE_ENV: 'production', DATABASE_URL: `file:${join(temporaryDirectory, 'browser.sqlite').replaceAll('\\', '/')}`,
  AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(), BETTER_AUTH_URL: origin,
  AI_API_KEY: 'browser-test-dummy', AI_BASE_URL: mock.baseURL, AI_MODEL: 'browser-mock', BAIDU_MAP_AK: '',
  NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), HOST: '127.0.0.1', PORT: String(port),
}
const steps: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] = []
const pageErrors: string[] = []
const externalRequests: string[] = []
const authResponses: { path: string; status: number }[] = []
let browser: Browser | undefined
let page: Page | undefined
let server: ReturnType<typeof Bun.spawn> | undefined
let serverOutput: Promise<string> | undefined
let serverErrors: Promise<string> | undefined
let failure: unknown

async function step(name: string, work: () => Promise<void>) {
  const start = Date.now()
  try { await work(); steps.push({ name, status: 'passed', durationMs: Date.now() - start }); console.log(`[browser] ${name}: passed`) }
  catch (error) {
    steps.push({ name, status: 'failed', durationMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) })
    if (process.env.BROWSER_CONTINUE_ON_FAILURE === '1') {
      failure ??= error
      process.exitCode = 1
      console.error(`[browser] ${name}: failed; 诊断模式继续后续检查，最终仍标为失败`)
      if (page) await page.screenshot({ path: join(artifacts, `failure-step-${steps.length}.png`), fullPage: true, animations: 'disabled' }).catch(() => {})
      return
    }
    throw error
  }
}

async function api<T>(method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown): Promise<T> {
  const response = await page!.request.fetch(`${origin}${path}`, { method, data, headers: { origin } })
  assert.ok(response.ok(), `测试 API ${method} ${path} 返回 ${response.status()}: ${(await response.text()).slice(0, 500)}`)
  return response.json() as Promise<T>
}

type PlanState = { id: number; version: number; revision: number; plan: { title: string; days: { city: string; spots: { name: string }[] }[]; foodJournal: { name: string }[]; summary: string } }
const details = (id: number) => api<PlanState>('GET', `/api/plans/${id}`)
const folder = (title: string) => page!.locator('.folder').filter({ has: page!.locator('.folder__title', { hasText: title }) })

async function showNavigation() {
  const button = page!.getByRole('button', { name: '打开行笺导航', exact: true })
  if (await button.isVisible() && await button.getAttribute('aria-expanded') !== 'true') await button.click()
}

async function openFolder(title: string) {
  await showNavigation()
  const target = folder(title)
  await expect(target).toBeVisible()
  // Listing a folder does not mean its automatic login restoration has finished.
  await expect(target.locator('.row--plan')).toBeEnabled()
  const toggle = target.locator('.folder__toggle')
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return target
}

async function openPlan(title: string, tab = '路线舆图') {
  const target = await openFolder(title)
  await target.locator('.row--plan').click()
  await page!.getByRole('tab', { name: tab, exact: true }).click()
  await expect(page!.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true')
}

async function openChat(title: string) {
  const target = await openFolder(title)
  await target.locator('.conversation-row .row').first().click()
  await page!.getByRole('tab', { name: '旅途对话', exact: true }).click()
  await expect(page!.locator('#travel-message')).toBeVisible()
}

async function register(email: string, password: string, name: string) {
  await page!.goto(`${origin}/login`)
  await page!.getByRole('tab', { name: '注册', exact: true }).click()
  await page!.getByPlaceholder('如何称呼你').fill(name)
  await page!.getByLabel('邮箱地址', { exact: true }).fill(email)
  await page!.getByLabel('密码', { exact: true }).fill(password)
  await page!.getByRole('button', { name: '注册，开启山海之旅', exact: true }).click()
  await expect(page!.getByRole('button', { name: /新建行笺/ })).toBeVisible({ timeout: 15000 })
}

async function createPlan(title: string) {
  await showNavigation()
  const created = page!.waitForResponse((response) => response.url() === `${origin}/api/plans` && response.request().method() === 'POST')
  const conversationCreated = page!.waitForResponse((response) => response.url() === `${origin}/api/conversations` && response.request().method() === 'POST')
  await page!.getByRole('button', { name: /新建行笺/ }).click()
  const response = await created
  assert.equal(response.status(), 200)
  const result = await response.json() as { planId: number }
  const conversationResponse = await conversationCreated
  assert.equal(conversationResponse.status(), 200)
  await expect(page!.locator('#travel-message')).toBeVisible()
  const current = await details(result.planId)
  await api('PATCH', `/api/plans/${result.planId}`, { title, expectedRevision: current.revision })
  await page!.reload()
  await expect(folder(title)).toBeVisible()
  return result.planId
}

async function assertWithinViewport(locator: Locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  const viewport = page!.viewportSize()
  assert.ok(box && viewport)
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    `输入控件超出可视范围: ${JSON.stringify({ box, viewport })}`)
}

try {
  await step('启动独立迁移与生产服务', async () => {
    const migrate = Bun.spawn([process.execPath, 'run', 'server/database/migrate.ts'], { env, stdout: 'pipe', stderr: 'pipe' })
    assert.equal(await migrate.exited, 0, await new Response(migrate.stderr).text())
    const launched = Bun.spawn([process.execPath, '.output/server/index.mjs'], { env, stdout: 'pipe', stderr: 'pipe' })
    server = launched
    serverOutput = new Response(launched.stdout).text()
    serverErrors = new Response(launched.stderr).text()
    let ready = false
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch { /* bounded readiness polling */ }
      if (server.exitCode !== null) break
      await Bun.sleep(250)
    }
    assert.ok(ready, '生产测试服务启动失败')
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    await context.route('**/*', async (route) => {
      const url = route.request().url()
      if (/^https?:/.test(url) && !url.startsWith(`${origin}/`)) {
        const parsed = new URL(url)
        externalRequests.push(`${parsed.origin}${parsed.pathname}`)
        await route.abort()
        return
      }
      await route.continue()
    })
    page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname
      if (path.startsWith('/api/auth/') || path === '/api/me') authResponses.push({ path, status: response.status() })
    })
    page.on('dialog', (dialog) => void dialog.accept())
  })
  const suffix = crypto.randomUUID().slice(0, 8)
  const accountA = { email: `browser-a-${suffix}@example.invalid`, password: `${crypto.randomUUID()}Aa9!` }
  const accountB = { email: `browser-b-${suffix}@example.invalid`, password: `${crypto.randomUUID()}Aa9!` }
  const titleA = `隔离行笺甲 ${suffix}`
  const titleB = `隔离行笺乙 ${suffix}`
  let planA = 0
  let planB = 0
  let initialVersion = 0

  await step('注册与 UI 创建两份行笺', async () => {
    await register(accountA.email, accountA.password, '浏览器测试甲')
    planA = await createPlan(titleA)
    const current = await details(planA)
    await api('POST', `/api/plans/${planA}/save`, { planJson: { ...current.plan, days: [{ date: '2026-10-01', city: '测试杭州', spots: [] }] }, expectedRevision: current.revision })
    initialVersion = (await details(planA)).version
    planB = await createPlan(titleB)
    assert.ok(planA !== planB)
  })

  await step('地点草稿跨规划切换与刷新恢复', async () => {
    await openPlan(titleA)
    await page!.getByRole('button', { name: '添一处', exact: true }).click()
    await page!.getByPlaceholder('写下想去的地方').fill('未保存的隔离地点')
    await page!.getByPlaceholder('预约、开门时间，或值得期待的小事').fill('仅用于浏览器测试的草稿笔记')
    await expect(page!.getByText('未保存的草稿 · 已保存在本机，切换行笺或刷新后可继续', { exact: true })).toBeVisible()
    await openPlan(titleB)
    await expect(page!.getByPlaceholder('写下想去的地方')).toHaveCount(0)
    await openPlan(titleA)
    await expect(page!.getByPlaceholder('写下想去的地方')).toHaveValue('未保存的隔离地点')
    await page!.reload()
    await openPlan(titleA)
    await expect(page!.getByPlaceholder('写下想去的地方')).toHaveValue('未保存的隔离地点')
    await page!.screenshot({ path: join(artifacts, '01-restored-location-draft.png'), fullPage: true, animations: 'disabled' })
  })

  await step('真实 409 保留草稿并明确比较后保存', async () => {
    const current = await details(planA)
    await api('PATCH', `/api/plans/${planA}`, { summary: '另一设备保存的摘要', expectedRevision: current.revision })
    const conflict = page!.waitForResponse((response) => response.url() === `${origin}/api/plans/${planA}/save` && response.status() === 409)
    await page!.getByRole('button', { name: '保存为新版本', exact: true }).click()
    await conflict
    await expect(page!.getByRole('alert').filter({ hasText: '版本冲突' })).toBeVisible()
    await expect(page!.getByPlaceholder('写下想去的地方')).toHaveValue('未保存的隔离地点')
    await page!.getByRole('button', { name: '比较最新内容', exact: true }).click()
    await page!.getByRole('button', { name: '在最新内容上重新应用草稿', exact: true }).click()
    await page!.getByRole('button', { name: '保存为新版本', exact: true }).click()
    await expect(page!.getByRole('button', { name: '编辑未保存的隔离地点', exact: true })).toBeVisible()
    const saved = await details(planA)
    assert.equal(saved.plan.summary, '另一设备保存的摘要')
    assert.equal(saved.plan.days[0]!.spots[0]!.name, '未保存的隔离地点')
  })

  await step('食记草稿跨规划切换与刷新恢复', async () => {
    await openPlan(titleA, '风物食记')
    await page!.getByRole('button', { name: '记一道风味', exact: true }).click()
    await page!.getByPlaceholder('例如：一碗片儿川').fill('隔离草稿面食')
    await page!.getByPlaceholder('味道如何、想点什么、忌口提醒，或与谁分享…').fill('食记刷新恢复测试')
    await expect(page!.getByText('未保存的草稿 · 已保存在本机，切换行笺或刷新后可继续', { exact: true })).toBeVisible()
    await openPlan(titleB, '风物食记')
    await expect(page!.getByPlaceholder('例如：一碗片儿川')).toHaveCount(0)
    await openPlan(titleA, '风物食记')
    await expect(page!.getByPlaceholder('例如：一碗片儿川')).toHaveValue('隔离草稿面食')
    await page!.reload()
    await openPlan(titleA, '风物食记')
    await expect(page!.getByPlaceholder('例如：一碗片儿川')).toHaveValue('隔离草稿面食')
    await page!.getByRole('button', { name: '保存这一味', exact: true }).click()
    await expect(page!.getByRole('heading', { name: '隔离草稿面食', exact: true })).toBeVisible()
    assert.equal((await details(planA)).plan.foodJournal[0]!.name, '隔离草稿面食')
  })

  await step('同规划切预览不中断真实 Mastra 模拟流与消息落库', async () => {
    await openChat(titleA)
    await page!.locator('#travel-message').fill('请给出慢旅行文字建议，浏览器验收无需修改行程。')
    await page!.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect(page!.getByText('正在整理旅行建议。', { exact: false }).first()).toBeVisible()
    await openPlan(titleA, '行程总览')
    await expect(page!.getByRole('button', { name: '正在生成 · 停止', exact: true })).toBeVisible()
    const conversations = await api<{ id: number }[]>('GET', `/api/conversations?planId=${planA}`)
    const conversationId = conversations[0]!.id
    await expect.poll(async () => {
      const result = await api<{ messages: { content: string }[] }>('GET', `/api/conversations/${conversationId}`)
      return result.messages.some((message) => message.content.includes(mock.marker))
    }, { timeout: 25000 }).toBe(true)
    assert.equal(mock.state.requests, 1)
    assert.equal(mock.state.completed, 1)
    assert.equal(mock.state.cancelled, 0)
    await openChat(titleA)
    await expect(page!.getByText(mock.marker, { exact: false }).first()).toBeVisible()
    await page!.reload()
    await openChat(titleA)
    await expect(page!.getByText(mock.marker, { exact: false }).first()).toBeVisible()
    await page!.screenshot({ path: join(artifacts, '02-completed-chat.png'), fullPage: true, animations: 'disabled' })
  })

  await step('版本路线切换保持历史且修订号递增', async () => {
    const before = await details(planA)
    const versions = await api<{ version: number }[]>('GET', `/api/plans/${planA}/versions`)
    await page!.getByRole('tab', { name: '版本路线', exact: true }).click()
    await page!.getByRole('button', { name: `版本 v${initialVersion}`, exact: true }).click()
    await page!.getByRole('button', { name: '切换到此版本', exact: true }).click()
    await expect.poll(async () => (await details(planA)).version).toBe(initialVersion)
    const after = await details(planA)
    assert.equal(after.revision, before.revision + 1)
    assert.equal((await api<unknown[]>('GET', `/api/plans/${planA}/versions`)).length, versions.length)
    assert.equal(after.plan.foodJournal.length, 0)
  })

  await step('移动端抽屉 Escape 焦点、页签键盘与缩小可视区域', async () => {
    await page!.setViewportSize({ width: 390, height: 844 })
    const menu = page!.getByRole('button', { name: '打开行笺导航', exact: true })
    await menu.focus()
    await menu.click()
    await expect(page!.getByRole('dialog', { name: '行笺与对话导航', exact: true })).toBeVisible()
    await expect(page!.getByRole('button', { name: '关闭导航', exact: true })).toBeFocused()
    await page!.keyboard.press('Escape')
    await expect(menu).toBeFocused()
    await expect(page!.locator('aside.ws')).toHaveAttribute('inert', '')
    await openPlan(titleA, '行程总览')
    await page!.getByRole('tab', { name: '行程总览', exact: true }).focus()
    await page!.keyboard.press('ArrowRight')
    await expect(page!.getByRole('tab', { name: '路线舆图', exact: true })).toBeFocused()
    await openChat(titleA)
    await page!.setViewportSize({ width: 390, height: 460 })
    await page!.locator('#travel-message').fill('缩小可视区域测试')
    await page!.locator('#travel-message').focus()
    await assertWithinViewport(page!.locator('#travel-message'))
    await assertWithinViewport(page!.getByRole('button', { name: '发送消息', exact: true }))
    await page!.screenshot({ path: join(artifacts, '03-mobile-reduced-viewport.png'), fullPage: true, animations: 'disabled' })
    await page!.setViewportSize({ width: 844, height: 390 })
    await assertWithinViewport(page!.locator('#travel-message'))
    await assertWithinViewport(page!.getByRole('button', { name: '发送消息', exact: true }))
    await page!.setViewportSize({ width: 1440, height: 1000 })
  })

  await step('退出换号不显示另一账号的行笺或草稿', async () => {
    await openPlan(titleA, '风物食记')
    await page!.getByRole('button', { name: '记一道风味', exact: true }).click()
    await page!.getByPlaceholder('例如：一碗片儿川').fill('仅属于账号甲的未保存食记')
    await expect(page!.getByText('未保存的草稿 · 已保存在本机，切换行笺或刷新后可继续', { exact: true })).toBeVisible()
    await page!.getByRole('button', { name: '查看账户与偏好设置', exact: true }).click()
    const signedOut = page!.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/sign-out' && response.request().method() === 'POST')
    await page!.getByRole('button', { name: '退出登录', exact: true }).click()
    assert.equal((await signedOut).status(), 200)
    await expect(page!).toHaveURL(`${origin}/login`)
    await expect(page!.getByRole('button', { name: '登录，启程', exact: true })).toBeVisible()
    await register(accountB.email, accountB.password, '浏览器测试乙')
    await expect(page!.locator('.folder')).toHaveCount(0)
    const newId = await createPlan(`账号乙行笺 ${suffix}`)
    await openPlan(`账号乙行笺 ${suffix}`, '风物食记')
    await expect(page!.getByPlaceholder('例如：一碗片儿川')).toHaveCount(0)
    const response = await page!.request.get(`${origin}/api/plans/${planA}`)
    assert.equal(response.status(), 404)
    assert.notEqual(newId, planA)
    await expect(page!.getByText('仅属于账号甲的未保存食记', { exact: true })).toHaveCount(0)
    await page!.screenshot({ path: join(artifacts, '04-account-isolation.png'), fullPage: true, animations: 'disabled' })
    // 再用真实登录界面登录原账号，确认注册与登录两个入口都经过浏览器。
    await page!.getByRole('button', { name: '查看账户与偏好设置', exact: true }).click()
    const signedOutAgain = page!.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/sign-out' && response.request().method() === 'POST')
    await page!.getByRole('button', { name: '退出登录', exact: true }).click()
    assert.equal((await signedOutAgain).status(), 200)
    await expect(page!).toHaveURL(`${origin}/login`)
    await expect(page!.getByRole('button', { name: '登录，启程', exact: true })).toBeVisible()
    await page!.getByLabel('邮箱地址', { exact: true }).fill(accountA.email)
    await page!.getByLabel('密码', { exact: true }).fill(accountA.password)
    const signedIn = page!.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/sign-in/email' && response.request().method() === 'POST')
    await page!.getByRole('button', { name: '登录，启程', exact: true }).click()
    assert.equal((await signedIn).status(), 200)
    await expect(page!).toHaveURL(`${origin}/`)
    await expect(folder(titleA)).toBeVisible()
    await openPlan(titleA, '风物食记')
    await expect(page!.getByPlaceholder('例如：一碗片儿川')).toHaveValue('仅属于账号甲的未保存食记')
  })
  await step('无未捕获 UI 异常或非预期 AI/地图请求，CDN 资源保持隔离', async () => {
    assert.deepEqual(pageErrors, [])
    const unexpected = externalRequests.filter(url => new URL(url).origin !== 'https://unpkg.com')
    assert.deepEqual(unexpected, [], '发现已声明静态资源之外的非预期外部请求，已全部阻断')
  })
} catch (error) {
  failure = error
  console.error(`[browser] FAILED: ${error instanceof Error ? error.message : String(error)}`)
  if (page) await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser?.close()
  server?.kill()
  if (server) await server.exited
  mock.server.stop(true)
  if (serverOutput) writeFileSync(join(artifacts, 'server.log'), await serverOutput)
  if (serverErrors) writeFileSync(join(artifacts, 'server-errors.log'), await serverErrors)
  writeFileSync(join(artifacts, 'report.json'), JSON.stringify({
    passed: !failure, runId, steps, pageErrors, authResponses, blockedExternalResources: [...new Set(externalRequests)], mock: mock.state,
    optionalResourceImpact: externalRequests.length ? 'Markdown 编辑器尝试的 unpkg 静态扩展已阻断；外部高亮、公式、图表与格式化扩展不在本轮验收范围，未实际访问 CDN。' : '未观察到外部静态资源请求。',
    scope: '生产 UI/HTTP、临时数据库、本地 OpenAI SSE。移动端使用桌面 Chromium 缩小 viewport，未模拟真实系统软键盘。',
  }, null, 2))
  const checked = realpathSync(temporaryDirectory)
  const segment = relative(temporaryRoot, checked)
  assert.ok(segment && segment !== '..' && !segment.startsWith(`..${sep}`) && resolve(temporaryRoot, segment) === checked, '停止清理：临时目录边界异常')
  rmSync(checked, { recursive: true })
  console.log(`[browser] report: ${join(artifacts, 'report.json')}`)
}

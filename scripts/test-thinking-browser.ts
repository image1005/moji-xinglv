/** Production browser acceptance, temporary SQLite, local DeepSeek streams and isolated search fixtures.
 * THINKING_BROWSER_LONG=1 exercises 50 seconds of reasoning and a 65-second bounded run timeout.
 * THINKING_BROWSER_UI_ONLY=1 rechecks controls and screenshots after a presentation-only change.
 */
import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { chromium, expect, type Browser, type Locator, type Page } from '@playwright/test'
import type { ModelConfiguration, ModelCapabilities } from '../shared/schemas/model-config'
import type { PlanDetail, VersionItem } from '../shared/schemas/workspace'
import { startThinkingModel } from './mock-thinking-ai'

assert(existsSync('.output/server/index.mjs'), '请先执行 bun run build')
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) process.env[key] = ''
process.env.NO_PROXY = process.env.no_proxy = 'localhost,127.0.0.1'
const temporaryRoot = realpathSync(tmpdir())
const directory = mkdtempSync(join(temporaryRoot, 'shanhai-thinking-test-'))
const databasePath = join(directory, 'thinking-test.db')
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const artifacts = resolve('.verification/thinking', runId)
mkdirSync(artifacts, { recursive: true })
const longReasoning = process.env.THINKING_BROWSER_LONG === '1'
const uiOnly = process.env.THINKING_BROWSER_UI_ONLY === '1'
if (uiOnly) console.log('[thinking-browser] UI_ONLY: 仅复核按钮、保存反馈和小屏布局；跳过模型组合、长思考、停止及失败/超时链路，不构成完整链路复验。')
const reasoningMs = longReasoning ? 50000 : 4000
const runTimeoutMs = longReasoning ? 65000 : 6000
const mock = startThinkingModel({ reasoningMs, stallMs: runTimeoutMs + 15000 })
const port = await new Promise<number>((resolvePort, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address()
    assert(address && typeof address !== 'string')
    probe.close(error => error ? reject(error) : resolvePort(address.port))
  })
})
const origin = `http://127.0.0.1:${port}`
const env = {
  ...process.env, NODE_ENV: 'production', DATABASE_URL: `file:${databasePath.replaceAll('\\', '/')}`,
  AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(), BETTER_AUTH_URL: origin,
  AI_PROVIDER: 'deepseek', AI_MODEL: 'deepseek-flash', AI_API_KEY: 'fixture-only', AI_BASE_URL: mock.baseURL,
  AI_DEEPSEEK_THINKING_LEVELS: 'off,light,standard,deep', AI_SEARCH_PROVIDER: 'tavily', AI_RUN_TIMEOUT_MS: String(runTimeoutMs),
  AI_OUTPUT_MAX_TOKENS: '4096', AI_THINKING_OUTPUT_MAX_TOKENS: '32768',
  TAVILY_API_KEY: 'fixture-only', BAIDU_MAP_AK: 'fixture-only', PRODUCT_MOCK_PROVIDERS: '1',
  NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), HOST: '127.0.0.1', PORT: String(port),
}
type Settings = { defaults: ModelConfiguration; capabilities: ModelCapabilities }
type Run = { requestId: string; status: string; errorCode: string | null }
const labels = { off: '关闭', light: '轻量', standard: '标准', deep: '深度' } as const
type WireWindow = typeof globalThis & { __thinkingEvents: Record<string, number> }
const steps: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] = []
const snapshots: { thinking: string; webSearch: boolean; requestId: string }[] = []
const pageErrors: string[] = [], externalRequests: string[] = []
let browser: Browser | undefined, page: Page | undefined, server: ReturnType<typeof Bun.spawn> | undefined
let stdout: Promise<string> | undefined, stderr: Promise<string> | undefined
let failure: unknown, planId = 0, conversationId = 0, counter = 0
let settings: Settings

async function step(name: string, work: () => Promise<void>) {
  const started = Date.now()
  try { await work(); steps.push({ name, status: 'passed', durationMs: Date.now() - started }); console.log(`[thinking-browser] ${name}: passed`) }
  catch (error) { steps.push({ name, status: 'failed', durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }); throw error }
}
async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await page!.request.fetch(`${origin}${path}`, { method, data, headers: { origin } })
  assert(response.ok(), `${path}: ${response.status()} ${(await response.text()).slice(0, 500)}`)
  return response.json() as Promise<T>
}
async function openChat() {
  const navigation = page!.getByRole('button', { name: '打开行笺导航', exact: true })
  if (await navigation.isVisible() && await navigation.getAttribute('aria-expanded') !== 'true') await navigation.click()
  const folder = page!.locator('.folder').filter({ has: page!.locator('.folder__title', { hasText: '思考与搜索验收' }) })
  await expect(folder).toBeVisible()
  if (await folder.locator('.folder__toggle').getAttribute('aria-expanded') !== 'true') await folder.locator('.folder__toggle').click()
  await folder.locator('.conversation-row .row').first().click()
  await page!.getByRole('tab', { name: '旅途对话', exact: true }).click()
  await expect(page!.locator('#travel-message')).toBeVisible()
  await expect(thinkingButton()).toBeEnabled()
}
const thinkingButton = () => page!.getByRole('button', { name: /^思考深度：/ })
const searchButton = () => page!.getByRole('button', { name: '智能搜索', exact: true })
const menu = () => page!.getByRole('menu', { name: '思考深度', exact: true })
async function chooseThinking(level: ModelConfiguration['thinking']) {
  if (await thinkingButton().getAttribute('aria-label') === `思考深度：${labels[level]}`) return
  await thinkingButton().click()
  await page!.getByRole('menuitemradio', { name: labels[level], exact: true }).click()
  await expect(thinkingButton()).toHaveAttribute('aria-label', `思考深度：${labels[level]}`)
}
async function chooseSearch(enabled: boolean) {
  if ((await searchButton().getAttribute('aria-pressed') === 'true') !== enabled) await searchButton().click()
  await expect(searchButton()).toHaveAttribute('aria-pressed', String(enabled))
}
async function persisted(thinking: ModelConfiguration['thinking'], webSearch: boolean) {
  await expect.poll(async () => {
    const value = await api<Settings>('/api/model-settings')
    return { thinking: value.defaults.thinking, webSearch: value.defaults.webSearch }
  }).toEqual({ thinking, webSearch })
}
async function runChat(instruction = '', expected = 'completed') {
  const before = await api<PlanDetail>(`/api/plans/${planId}`)
  const versionsBefore = await api<VersionItem[]>(`/api/plans/${planId}/versions`)
  const marker = `thinking-case-${++counter}`
  await page!.locator('#travel-message').fill(`${marker} ${instruction || '请先核对行笺再给建议，保持旅行内容不变。'}`)
  const response = page!.waitForResponse(value => value.url() === `${origin}/api/chat` && value.request().method() === 'POST')
  await page!.getByRole('button', { name: '发送消息', exact: true }).click()
  const chatResponse = await response
  const request = JSON.parse(chatResponse.request().postData()!.trim()) as { requestId: string; configuration: ModelConfiguration }
  let terminal: Run | undefined
  await expect.poll(async () => {
    terminal = (await api<Run[]>(`/api/chat/runs?conversationId=${conversationId}`)).find(run => run.requestId === request.requestId)
    return terminal && ['completed', 'failed', 'cancelled', 'interrupted'].includes(terminal.status)
  }, { timeout: runTimeoutMs + 15000 }).toBe(true)
  assert.equal(terminal!.status, expected, `${marker}: ${terminal!.errorCode ?? 'unexpected terminal'}; ${mock.state.rejected.at(-1) ?? ''}`)
  await expect(page!.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0)
  if (expected === 'completed') await expect(page!.locator('.chat-message').filter({ hasText: `隔离正文已完成 ${marker}。` })).toBeVisible()
  const after = await api<PlanDetail>(`/api/plans/${planId}`)
  assert.deepEqual({ version: after.version, revision: after.revision, plan: after.plan }, { version: before.version, revision: before.revision, plan: before.plan }, '只读思考、搜索或失败不能改变正式行程')
  assert.deepEqual(await api<VersionItem[]>(`/api/plans/${planId}/versions`), versionsBefore, '只读任务不产生版本或重复命名')
  assert.deepEqual((await api<{ drafts: unknown[] }>(`/api/plans/${planId}/drafts`)).drafts, [], '只读任务不创建草稿')
  return { marker, request, chatResponse }
}
async function withinViewport(locator: Locator) {
  const box = await locator.boundingBox(), viewport = page!.viewportSize()
  assert(box && viewport)
  assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, JSON.stringify({ box, viewport }))
}
async function screenshot(name: string) {
  await page!.screenshot({ path: join(artifacts, name), fullPage: true, animations: 'disabled' })
}

try {
  await step('临时数据库、生产应用与回环模型启动', async () => {
    const migration = Bun.spawn([process.execPath, 'run', 'server/database/migrate.ts'], { env, stdout: 'pipe', stderr: 'pipe' })
    assert.equal(await migration.exited, 0, await new Response(migration.stderr).text())
    const launched = Bun.spawn([process.execPath, '--preload', './scripts/mock-providers-preload.ts', '.output/server/index.mjs'], { env, stdout: 'pipe', stderr: 'pipe' })
    server = launched
    stdout = new Response(launched.stdout).text(); stderr = new Response(launched.stderr).text()
    let ready = false
    for (let i = 0; i < 100; i++) {
      assert(server.exitCode === null, '生产服务提前退出')
      try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch { /* bounded readiness check */ }
      await Bun.sleep(100)
    }
    assert(ready)
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined })
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    page.setDefaultTimeout(10000)
    // Observe the actual bytes consumed by Chat without teeing the stream or changing cancellation.
    // Chromium cannot always retrieve a streamed fetch body after the SDK cancels its finished reader.
    await page.addInitScript(() => {
      const observed = globalThis as WireWindow
      observed.__thinkingEvents = {}
      const originalFetch = globalThis.fetch
      globalThis.fetch = Object.assign(async (...args: Parameters<typeof fetch>) => {
        const response = await originalFetch(...args)
        if (!response.url.endsWith('/api/chat') || !response.body) return response
        const originalGetReader = response.body.getReader
        let pending = ''
        const decoder = new TextDecoder()
        Object.defineProperty(response.body, 'getReader', { value(...readerArgs: unknown[]) {
          const reader = Reflect.apply(originalGetReader, this, readerArgs) as ReadableStreamDefaultReader<Uint8Array>
          const originalRead = reader.read
          Object.defineProperty(reader, 'read', { value: async function () {
            const result = await originalRead.call(reader)
            if (result.value) {
              pending += decoder.decode(result.value, { stream: true })
              const lines = pending.split('\n')
              pending = lines.pop() ?? ''
              for (const line of lines.filter(Boolean)) {
                const event = JSON.parse(line) as { chunk?: { type?: string } }
                const type = event.chunk?.type
                if (type) observed.__thinkingEvents[type] = (observed.__thinkingEvents[type] ?? 0) + 1
              }
            }
            return result
          } })
          return reader
        } })
        return response
      }, { preconnect: originalFetch.preconnect })
    })
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === origin || /^(data|blob):/.test(url.href)) return route.continue()
      externalRequests.push(url.origin + url.pathname)
      return route.abort()
    })
    await api('/api/auth/sign-up/email', 'POST', { email: `${crypto.randomUUID()}@example.invalid`, password: crypto.randomUUID() + 'Aa9!', name: '思考按钮验收' })
    planId = (await api<{ planId: number }>('/api/plans', 'POST', { title: '思考与搜索验收' })).planId
    conversationId = (await api<{ id: number }>('/api/conversations', 'POST', { planId })).id
    settings = await api<Settings>('/api/model-settings')
    assert(settings.capabilities.thinkingLevels.includes('deep'))
    assert(settings.capabilities.search.available)
    await page.goto(origin)
    await openChat()
    await expect.poll(async () => {
      const versions = await api<VersionItem[]>(`/api/plans/${planId}/versions`)
      return versions.length === 1 && versions[0]?.nameSource === 'ai' && versions[0]?.name === '隔离验证行程定稿'
    }, { timeout: 20000 }).toBe(true)
    assert.equal(mock.state.namingRequests, 1, '初始版本命名与思考请求分开统计')
  })
  await step('思考菜单键盘、选中状态、Escape 与外部点击焦点', async () => {
    await thinkingButton().focus()
    await page!.keyboard.press('Enter')
    await expect(menu()).toBeVisible()
    await expect(page!.getByRole('menuitemradio', { name: '关闭', exact: true })).toHaveAttribute('aria-checked', 'true')
    await page!.keyboard.press('End')
    await expect(page!.getByRole('menuitemradio', { name: '深度', exact: true })).toBeFocused()
    await page!.keyboard.press('Home')
    await expect(page!.getByRole('menuitemradio', { name: '关闭', exact: true })).toBeFocused()
    await page!.keyboard.press('ArrowDown')
    await expect(page!.getByRole('menuitemradio', { name: '轻量', exact: true })).toBeFocused()
    await page!.keyboard.press('Escape')
    await expect(menu()).toHaveCount(0)
    await expect(thinkingButton()).toBeFocused()
    await thinkingButton().press('ArrowDown')
    await page!.keyboard.press('Tab')
    await expect(menu()).toHaveCount(0)
    await expect(searchButton()).toBeFocused()
    await thinkingButton().click()
    await page!.locator('#travel-message').click()
    await expect(menu()).toHaveCount(0)
    await expect(page!.locator('#travel-message')).toBeFocused()
    await thinkingButton().click()
    await withinViewport(menu())
    await screenshot('01-desktop-thinking-menu.png')
    await page!.keyboard.press('Escape')
  })
  if (!uiOnly) await step('全部支持档位 × 独立搜索开关：刷新、请求快照、思考后工具与正文', async () => {
    for (const thinking of settings.capabilities.thinkingLevels) {
      for (const webSearch of [false, true]) {
        await chooseThinking(thinking)
        await chooseSearch(webSearch)
        await persisted(thinking, webSearch)
        await page!.reload()
        await openChat()
        await expect(thinkingButton()).toHaveAttribute('aria-label', `思考深度：${labels[thinking]}`)
        await expect(searchButton()).toHaveAttribute('aria-pressed', String(webSearch))
        const { marker, request } = await runChat()
        assert.equal(request.configuration.thinking, thinking)
        assert.equal(request.configuration.webSearch, webSearch)
        const readOnly = new Database(databasePath, { readonly: true })
        try {
          const stored = readOnly.query('SELECT configuration_json FROM chat_runs WHERE request_id = ?').get(request.requestId) as { configuration_json: string }
          assert.deepEqual(JSON.parse(stored.configuration_json), request.configuration)
        } finally { readOnly.close() }
        const providerRequests = mock.state.requests.filter(value => value.marker === marker)
        assert.equal(providerRequests.length, webSearch ? 3 : 2)
        assert(providerRequests.every(value => value.searchEnabled === webSearch && value.reasoningPreserved))
        assert(providerRequests.every(value => value.thinking === (thinking === 'off' ? 'disabled' : 'enabled')))
        assert(providerRequests.every(value => value.maxTokens === (thinking === 'off' ? 4096 : 32768)), '普通输出和思考输出预算必须分别传递到供应商')
        if (thinking !== 'off') assert(providerRequests.every(value => value.effort === ({ light: 'low', standard: 'high', deep: 'max' })[thinking]))
        snapshots.push({ thinking, webSearch, requestId: request.requestId })
      }
    }
    assert.deepEqual(mock.state.rejected, [])
    await screenshot('02-deep-search-tool-continuation.png')
  })
  await step('配置保存失败可见、重试保存并刷新保留', async () => {
    await chooseThinking('deep')
    await chooseSearch(false)
    await persisted('deep', false)
    let failSave = true
    await page!.route('**/api/model-settings', async route => {
      if (route.request().method() === 'PUT' && failSave) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ statusMessage: '隔离验收：配置保存暂时失败' }) })
      } else await route.continue()
    })
    await searchButton().click()
    await expect(page!.getByRole('alert').filter({ hasText: '隔离验收：配置保存暂时失败' })).toBeVisible()
    await expect(searchButton()).toHaveAttribute('aria-pressed', 'true')
    assert.equal((await api<Settings>('/api/model-settings')).defaults.webSearch, false)
    await screenshot('03-save-failure-feedback.png')
    failSave = false
    await page!.getByRole('button', { name: '重试保存', exact: true }).click()
    await persisted('deep', true)
    await expect(page!.getByRole('alert').filter({ hasText: '隔离验收：配置保存暂时失败' })).toHaveCount(0)
    await page!.unroute('**/api/model-settings')
    await page!.reload(); await openChat()
    await expect(searchButton()).toHaveAttribute('aria-pressed', 'true')
  })
  if (!uiOnly) await step('深度思考停止后结束状态并可再次发送', async () => {
    const marker = `thinking-case-${++counter}`
    await page!.locator('#travel-message').fill(`${marker} fixture-stop`)
    await page!.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect(page!.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
    await expect.poll(() => mock.state.requests.some(value => value.marker === marker)).toBe(true)
    await page!.getByRole('button', { name: '停止生成', exact: true }).click()
    await expect.poll(async () => (await api<Run[]>(`/api/chat/runs?conversationId=${conversationId}`))[0]?.status).toBe('cancelled')
    await runChat()
  })
  if (!uiOnly) await step('持续思考片段经过 JSONL 到达浏览器，再继续工具调用与正文', async () => {
    const before = await page!.evaluate(() => (globalThis as WireWindow).__thinkingEvents)
    await runChat('fixture-delayed')
    const after = await page!.evaluate(() => (globalThis as WireWindow).__thinkingEvents)
    assert((after['reasoning-delta'] ?? 0) - (before['reasoning-delta'] ?? 0) >= 30, '持续思考片段必须传递至浏览器，不可被 Mastra 默认选项丢弃')
    assert((after['tool-input-available'] ?? 0) > (before['tool-input-available'] ?? 0))
    assert((after['text-delta'] ?? 0) > (before['text-delta'] ?? 0))
  })
  if (!uiOnly) await step('供应商失败、思考耗尽预算及有界超时之后均可重新发送', async () => {
    for (const scenario of ['fixture-provider-error', 'fixture-length', 'fixture-timeout']) {
      await runChat(scenario, 'failed')
      if (scenario === 'fixture-timeout') await screenshot('04-timeout-recovery.png')
      await runChat()
    }
  })
  await step('移动端及横屏弹层位于视口内、独立开关与焦点返回', async () => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 390, height: 460 }, { width: 320, height: 460 }, { width: 844, height: 390 }]) {
      await page!.setViewportSize(viewport)
      await thinkingButton().click()
      await withinViewport(menu())
      const teleported = await menu().evaluate(element => element.parentElement === element.ownerDocument.body)
      assert(teleported, '菜单必须脱离输入区 overflow 容器')
      const bounds = await menu().boundingBox(), selected = await menu().locator('[aria-checked="true"]').boundingBox()
      assert(bounds && selected && selected.y >= bounds.y && selected.y + selected.height <= bounds.y + bounds.height, '小屏打开菜单时，当前选中项必须在菜单滚动区内可见')
      await screenshot(`05-mobile-menu-${viewport.width}x${viewport.height}.png`)
      await page!.keyboard.press('Escape')
      await expect(thinkingButton()).toBeFocused()
      await withinViewport(searchButton())
    }
    await page!.setViewportSize({ width: 1440, height: 1000 })
  })
  await step('明确的能力响应夹具：不支持项禁用并说明原因', async () => {
    const current = await api<Settings>('/api/model-settings')
    await page!.route('**/api/model-settings', async route => {
      if (route.request().method() !== 'GET') { await route.continue(); return }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ...current, defaults: { model: current.defaults.model, thinking: 'off', webSearch: false },
        capabilities: { ...current.capabilities, thinkingLevels: ['off'], search: { available: false, provider: null, native: false } },
      }) })
    })
    await page!.reload(); await openChat()
    await expect(searchButton()).toBeDisabled()
    await thinkingButton().click()
    const deep = page!.getByRole('menuitemradio', { name: '深度', exact: true })
    await expect(deep).toHaveAttribute('aria-disabled', 'true')
    await expect(menu()).toContainText(/不支持|未验证|未确认/)
    await deep.focus()
    await page!.keyboard.press('Enter')
    await expect(thinkingButton()).toHaveAttribute('aria-label', '思考深度：关闭')
    await expect(menu()).toBeVisible()
    await screenshot('06-unsupported-explanations.png')
    await page!.keyboard.press('Escape')
    await page!.unroute('**/api/model-settings')
  })
  await step('无未捕获浏览器异常，所有供应商调用保持隔离', async () => {
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(externalRequests.filter(url => new URL(url).origin !== 'https://unpkg.com'), [])
  })
} catch (error) {
  failure = error
  process.exitCode = 1
  console.error(`[thinking-browser] FAILED: ${error instanceof Error ? error.message : String(error)}`)
  if (page) await screenshot('failure.png').catch(() => {})
} finally {
  await browser?.close()
  server?.kill()
  if (server) await server.exited
  mock.server.stop(true)
  if (stdout) writeFileSync(join(artifacts, 'server.log'), await stdout)
  if (stderr) writeFileSync(join(artifacts, 'server-errors.log'), await stderr)
  writeFileSync(join(artifacts, 'report.json'), JSON.stringify({
    passed: !failure, runId, uiOnly, reasoningMs, runTimeoutMs, steps, snapshots, pageErrors, blockedExternalResources: [...new Set(externalRequests)], mock: mock.state,
    scope: uiOnly
      ? 'Controls-only follow-up: production UI/HTTP, temporary SQLite, keyboard/focus, configuration persistence/failure, small-screen selected-item visibility and explicitly replaced unsupported capability response. Model combinations, reasoning stream, tool continuation, stop and failure/timeout recovery were skipped; use the separate full report for those results.'
      : 'Production Nuxt UI/HTTP, temporary migrated SQLite, installed DeepSeek SDK + Mastra, local official-shaped SSE and intercepted Tavily responses. Unsupported-state display uses an explicitly replaced capability response. Chromium viewports do not emulate a real system keyboard. No real provider availability or answer-quality claim.',
  }, null, 2))
  const checked = realpathSync(directory), segment = relative(temporaryRoot, checked)
  assert(segment && segment !== '..' && !segment.startsWith(`..${sep}`) && resolve(temporaryRoot, segment) === checked, '停止清理：临时目录边界异常')
  rmSync(checked, { recursive: true })
  console.log(`[thinking-browser] report: ${join(artifacts, 'report.json')}`)
}

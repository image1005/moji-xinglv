/** Real process-exit recovery drill: production build, private temporary SQLite and loopback-only SSE. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import type { PlanPreview } from '../shared/types'

assert(existsSync('.output/server/index.mjs'), '请先运行 bun run build')
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) process.env[key] = ''
process.env.NO_PROXY = process.env.no_proxy = 'localhost,127.0.0.1'

const temporaryRoot = realpathSync(tmpdir())
const directory = mkdtempSync(join(temporaryRoot, 'shanhai-recovery-'))
const reportDirectory = resolve('.verification/recovery', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(reportDirectory, { recursive: true })
const marker = `recovery-${crypto.randomUUID()}`
const steps: { name: string; durationMs: number }[] = []
const state = { planId: 0, requests: 0, toolIssued: false, holding: false, mode: 'edit' as 'edit' | 'complete' }
let service: ReturnType<typeof Bun.spawn> | undefined
let mock: ReturnType<typeof Bun.serve> | undefined
let serviceOutput: Promise<string> | undefined
let serviceErrors: Promise<string> | undefined
const logs: string[] = []
const errors: string[] = []
const requestAbort = new AbortController()
let pendingStream: Promise<string> | undefined
let passed = false

async function step(name: string, action: () => Promise<void>) {
  const started = Date.now()
  await action()
  steps.push({ name, durationMs: Date.now() - started })
  console.log(`[recovery] ${name}: passed`)
}

async function stopService(force = false) {
  if (!service) return
  if (service.exitCode === null) service.kill(force ? 'SIGKILL' : 'SIGTERM')
  await service.exited
  if (serviceOutput) logs.push(await serviceOutput)
  if (serviceErrors) errors.push(await serviceErrors)
  service = undefined
  serviceOutput = serviceErrors = undefined
}

try {
  mock = Bun.serve({
    hostname: '127.0.0.1', port: 0, idleTimeout: 60,
    async fetch(request) {
      assert.equal(new URL(request.url).pathname, '/v1/chat/completions', '模拟模型不接受其他上游接口')
      assert.equal(request.method, 'POST')
      await request.json()
      state.requests++
      const encoder = new TextEncoder()
      const id = `chatcmpl-${crypto.randomUUID()}`
      const chunk = (delta: Record<string, unknown>, reason: string | null = null) => ({
        id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'recovery-mock',
        choices: [{ index: 0, delta, finish_reason: reason }],
      })
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
          send(chunk({ role: 'assistant', content: '' }))
          if (state.mode === 'edit' && state.toolIssued) {
            state.holding = true
            send(chunk({ content: '工具已保存修改，继续生成中。' }))
            // Deliberately leave the stream open. Only killing our server interrupts this run.
            return
          }
          if (state.mode === 'edit') {
            assert(state.planId > 0)
            state.toolIssued = true
            send(chunk({ tool_calls: [{ index: 0, id: 'recovery-tool-call', type: 'function', function: {
              name: 'apply_plan_edits', arguments: JSON.stringify({ planId: state.planId, edits: [{ target: 'plan', action: 'update', value: { summary: marker } }] }),
            } }] }))
            send(chunk({}, 'tool_calls'))
          } else {
            send(chunk({ content: '重启后新一轮已完成。' }))
            send(chunk({}, 'stop'))
          }
          send({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'recovery-mock', choices: [], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } })
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
    },
  })
  const port = await new Promise<number>((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (!address || typeof address === 'string') { probe.close(); reject(new Error('无法分配恢复测试端口')); return }
      probe.close(error => error ? reject(error) : resolvePort(address.port))
    })
  })
  const origin = `http://127.0.0.1:${port}`
  const env = {
    ...process.env, NODE_ENV: 'production', DATABASE_URL: `file:${join(directory, 'recovery.sqlite').replaceAll('\\', '/')}`,
    AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(), BETTER_AUTH_URL: origin,
    AI_API_KEY: 'recovery-test-dummy', AI_BASE_URL: `http://127.0.0.1:${mock.port}/v1`, AI_MODEL: 'recovery-mock', BAIDU_MAP_AK: '',
    AI_GLOBAL_CONCURRENCY: '1', AI_USER_CONCURRENCY: '1', AI_REQUESTS_PER_PERIOD: '20', AI_GLOBAL_REQUESTS_PER_PERIOD: '20',
    NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), HOST: '127.0.0.1', PORT: String(port),
  }
  const cookies = new Map<string, string>()
  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    headers.set('origin', origin)
    if (cookies.size) headers.set('cookie', [...cookies.values()].join('; '))
    const response = await fetch(`${origin}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(15000), redirect: 'manual' })
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0]!
      cookies.set(pair.slice(0, pair.indexOf('=')), pair)
    }
    return response
  }
  const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const chatPost = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/x-ndjson' }, body: `${JSON.stringify(body)}\n` })
  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await request(path, init)
    assert(response.ok, `${path} 返回 HTTP ${response.status}: ${(await response.clone().text()).slice(0, 400)}`)
    return response.json() as Promise<T>
  }
  async function startService() {
    const launched = Bun.spawn([process.execPath, '.output/server/index.mjs'], { env, stdout: 'pipe', stderr: 'pipe' })
    service = launched
    serviceOutput = new Response(launched.stdout).text()
    serviceErrors = new Response(launched.stderr).text()
    for (let i = 0; i < 80; i++) {
      assert(launched.exitCode === null, '恢复测试服务启动失败')
      try { if ((await request('/login', { signal: AbortSignal.timeout(1000) })).ok) return } catch { /* bounded readiness polling */ }
      await Bun.sleep(100)
    }
    throw new Error('恢复测试服务未在时限内就绪')
  }
  type PlanState = { version: number; revision: number; plan: { summary: string } }
  type Message = { id: number; role: string; content: string; preview: PlanPreview | null; planVersion: number | null }
  type Run = { requestId: string; status: string; assistantMessageId: number | null; errorCode: string | null }
  let conversationId = 0
  let beforePlan: PlanState | undefined
  let beforeMessages: Message[] = []
  let beforeVersions: { id: number; version: number }[] = []
  const requestId = crypto.randomUUID()
  const chatBody = () => ({ protocolVersion: 1, type: 'message', messageId: 'recovery-user', planId: state.planId, conversationId, requestId, message: { id: 'recovery-user', role: 'user', parts: [{ type: 'text', text: '只修改行程简介，然后继续说明。' }] } })

  await step('启动独立数据库、注册测试账号与规划', async () => {
    const migration = Bun.spawn([process.execPath, 'run', 'server/database/migrate.ts'], { env, stdout: 'pipe', stderr: 'pipe' })
    assert.equal(await migration.exited, 0, await new Response(migration.stderr).text())
    await startService()
    await json('/api/auth/sign-up/email', post({ email: `${crypto.randomUUID()}@example.invalid`, password: crypto.randomUUID() + 'Aa9!', name: '进程恢复测试' }))
    assert(cookies.size > 0)
    const plan = await json<{ planId: number }>('/api/plans', post({ title: marker }))
    state.planId = plan.planId
    const conversation = await json<{ id: number }>('/api/conversations', post({ planId: state.planId, title: marker }))
    conversationId = conversation.id
  })

  await step('真实工具提交成功且第二步仍在生成', async () => {
    const response = await request('/api/chat', { ...chatPost(chatBody()), signal: AbortSignal.any([requestAbort.signal, AbortSignal.timeout(30000)]) })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /application\/x-ndjson/)
    pendingStream = response.text().catch(() => '')
    let committed = false
    for (let i = 0; i < 120; i++) {
      const current = await json<PlanState>(`/api/plans/${state.planId}`)
      const detail = await json<{ messages: Message[] }>(`/api/conversations/${conversationId}`)
      const tasks = await json<Run[]>(`/api/chat/runs?conversationId=${conversationId}`)
      const assistant = detail.messages.find(message => message.role === 'assistant')
      if (state.holding && current.plan.summary === marker && tasks[0]?.status === 'running' && assistant?.preview?.summary === marker) {
        beforePlan = current
        beforeMessages = detail.messages
        beforeVersions = await json(`/api/plans/${state.planId}/versions`)
        committed = true
        break
      }
      await Bun.sleep(100)
    }
    assert(committed, '未观察到工具事务已提交且任务仍在运行的边界')
    assert.equal(beforePlan!.version, 2)
    assert.equal(beforeMessages.length, 2)
    assert.equal(beforeVersions.length, 2)
    assert.equal(state.requests, 2)
  })

  await step('强制终止自己启动的服务，再使用同库同端口重启', async () => {
    assert(service && service.exitCode === null)
    await stopService(true)
    requestAbort.abort()
    await pendingStream
    state.mode = 'complete'
    await startService()
  })

  await step('恢复已提交预览、标记中断并拒绝重复请求', async () => {
    const current = await json<PlanState>(`/api/plans/${state.planId}`)
    assert.deepEqual(current, beforePlan)
    const detail = await json<{ messages: Message[] }>(`/api/conversations/${conversationId}`)
    assert.equal(detail.messages.length, beforeMessages.length)
    const assistant = detail.messages.find(message => message.role === 'assistant')!
    const oldAssistant = beforeMessages.find(message => message.role === 'assistant')!
    assert.deepEqual(assistant.preview, oldAssistant.preview)
    assert.equal(assistant.planVersion, oldAssistant.planVersion)
    assert.match(assistant.content, /服务重启中断/)
    const tasks = await json<Run[]>(`/api/chat/runs?conversationId=${conversationId}`)
    assert.equal(tasks[0]!.requestId, requestId)
    assert.equal(tasks[0]!.status, 'interrupted')
    assert.equal(tasks[0]!.errorCode, 'server_restart')
    const repeated = await request('/api/chat', chatPost(chatBody()))
    assert.equal(repeated.status, 409)
    await repeated.text()
    assert.equal(state.requests, 2, '重试不应触发模型或重复编辑')
    assert.deepEqual(await json(`/api/plans/${state.planId}/versions`), beforeVersions)
    assert.equal((await json<{ messages: Message[] }>(`/api/conversations/${conversationId}`)).messages.length, beforeMessages.length)
  })

  await step('新请求正常完成，并发名额已释放', async () => {
    const freshId = crypto.randomUUID()
    const response = await request('/api/chat', chatPost({ ...chatBody(), requestId: freshId }))
    assert.equal(response.status, 200)
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line))
    assert(JSON.stringify(events).includes('重启后新一轮已完成'))
    assert.equal(events.at(-1).type, 'terminal')
    assert.equal(events.at(-1).status, 'completed')
    const tasks = await json<Run[]>(`/api/chat/runs?conversationId=${conversationId}`)
    assert.equal(tasks.find(task => task.requestId === freshId)?.status, 'completed')
    assert.equal(tasks.find(task => task.requestId === requestId)?.status, 'interrupted')
    assert.equal(state.requests, 3)
    assert.deepEqual(await json(`/api/plans/${state.planId}/versions`), beforeVersions)
    assert.equal((await json<{ messages: Message[] }>(`/api/conversations/${conversationId}`)).messages.length, 4)
  })
  passed = true
} catch (error) {
  console.error(`[recovery] FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  requestAbort.abort()
  await stopService()
  mock?.stop(true)
  writeFileSync(join(reportDirectory, 'report.json'), JSON.stringify({ passed, steps, modelRequests: state.requests, scope: '生产构建、真实强制进程退出与同库重启、临时SQLite、本地SSE；未访问真实AI或用户数据库。' }, null, 2))
  writeFileSync(join(reportDirectory, 'server.log'), logs.join('\n'))
  writeFileSync(join(reportDirectory, 'server-errors.log'), errors.join('\n'))
  const checked = realpathSync(directory)
  const segment = relative(temporaryRoot, checked)
  assert(segment && segment !== '..' && !segment.startsWith(`..${sep}`) && resolve(temporaryRoot, segment) === checked, '停止清理：恢复测试临时目录边界异常')
  rmSync(checked, { recursive: true })
  console.log(`[recovery] report: ${join(reportDirectory, 'report.json')}`)
}

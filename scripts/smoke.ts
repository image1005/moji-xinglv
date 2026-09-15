/**
 * 仅对专用测试环境执行 `bun run smoke`，需显式提供 SMOKE_EMAIL / SMOKE_PASSWORD。
 * 默认仅允许本机；只创建本次临时规划与会话，finally 删除该规划及其级联数据。
 * 不注册用户、不改偏好、不请求 AI / 百度。退出码：0 通过，1 检查或清理失败，2 配置错误。
 */
import assert from 'node:assert/strict'
import { PlanSchema, type Plan } from '../shared/schemas/plan'

function readConfig() {
  const base = new URL(process.env.SMOKE_BASE ?? 'http://localhost:3000')
  assert(['http:', 'https:'].includes(base.protocol), 'SMOKE_BASE 仅支持 HTTP(S)')
  assert(!base.username && !base.password && base.pathname === '/' && !base.search && !base.hash,
    'SMOKE_BASE 必须是不带凭据、路径、查询或片段的源地址')
  const local = ['localhost', '127.0.0.1'].includes(base.hostname)
  assert(local || process.env.SMOKE_ALLOW_REMOTE === 'true',
    '拒绝非本机目标；仅获授权的独立测试环境可显式设置 SMOKE_ALLOW_REMOTE=true')
  const email = process.env.SMOKE_EMAIL?.trim()
  const password = process.env.SMOKE_PASSWORD
  assert(email && password, '必须显式设置 SMOKE_EMAIL 与 SMOKE_PASSWORD，不使用种子账号默认值')
  const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 15000)
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000,
    'SMOKE_TIMEOUT_MS 必须为 1–120000 的整数')
  return { base: base.origin, email, password, timeoutMs }
}

async function run(config: ReturnType<typeof readConfig>) {
  const cookies = new Map<string, string>()
  let createdPlanId: number | undefined
  let conversationId: number | undefined
  let passed = 0
  let failures = 0

  async function request(path: string, init: RequestInit & { anon?: boolean } = {}) {
    const { anon, ...options } = init
    const headers = new Headers(options.headers)
    headers.set('origin', config.base)
    if (!anon && cookies.size) headers.set('cookie', [...cookies.values()].join('; '))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const response = await fetch(`${config.base}${path}`, {
        ...options, headers, signal: controller.signal, redirect: 'manual',
      })
      for (const raw of response.headers.getSetCookie()) {
        const pair = raw.split(';')[0]!
        cookies.set(pair.slice(0, pair.indexOf('=')), pair)
      }
      // 超时覆盖响应体读取，避免服务端只发送响应头后无限挂起。
      const text = await response.text()
      return { status: response.status, ok: response.ok, text }
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`${path} 请求超时（${config.timeoutMs}ms）`, { cause: error })
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async function json<T>(path: string, init?: RequestInit & { anon?: boolean }): Promise<T> {
    const response = await request(path, init)
    assert(response.ok, `${path} 期望 2xx，实际 ${response.status}`)
    return JSON.parse(response.text) as T
  }

  function post(body: unknown): RequestInit {
    return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  }

  async function step(name: string, action: () => Promise<void>) {
    try {
      await action()
      passed += 1
      console.log(`[通过] ${name}`)
    } catch (error) {
      throw new Error(`${name}：${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }

  async function expectPlan(version: number, plan: Plan) {
    const actual = await json<{ id: number; version: number; plan: Plan }>(`/api/plans/${createdPlanId}`)
    assert.equal(actual.id, createdPlanId)
    assert.equal(actual.version, version, '当前版本不匹配')
    assert.deepEqual(actual.plan, plan, '行程真实内容不匹配')
  }

  const marker = `smoke-${crypto.randomUUID()}`
  const initialInput = {
    title: marker,
    days: [{ city: '冒烟测试城', spots: [{ name: '待补坐标景点' }] }],
  }
  const initial = PlanSchema.parse(initialInput)
  const edited = PlanSchema.parse({
    ...initial,
    summary: `仅用于本次冒烟检查 ${marker}`,
    foodJournal: [{ id: `${marker}-food`, name: '测试点心', status: 'tasted', rating: 4 }],
    checklist: [{ id: `${marker}-check`, text: '核对行程', done: true }],
  })

  console.log(`[smoke] 目标 ${config.base}；只写入本次临时规划 ${marker}`)
  try {
    await step('登录页与匿名 API 权限', async () => {
      assert.equal((await request('/login', { anon: true })).status, 200)
      assert.equal((await request('/api/plans', { anon: true })).status, 401)
    })

    await step('使用显式测试凭据登录', async () => {
      const response = await request('/api/auth/sign-in/email', {
        ...post({ email: config.email, password: config.password }), anon: true,
      })
      assert(response.ok, `登录失败 HTTP ${response.status}`)
      assert(cookies.size > 0, '未收到会话 Cookie')
      const me = await json<{ user: { email: string } }>('/api/me')
      assert.equal(me.user.email.toLowerCase(), config.email.toLowerCase())
    })

    await step('创建独立临时规划并核对默认字段', async () => {
      const result = await json<{ planId: number; version: number }>('/api/plans', post({ planJson: initialInput }))
      assert(Number.isSafeInteger(result.planId) && result.planId > 0, '创建接口未返回有效规划 ID')
      // 在后续断言前记录本次创建结果，保证失败时仍能清理。
      createdPlanId = result.planId
      assert.equal(result.version, 1)
      await expectPlan(1, initial)
      const plans = await json<{ id: number; title: string }[]>('/api/plans')
      assert(plans.some((plan) => plan.id === createdPlanId && plan.title === marker), '规划列表未包含本次资源')
    })

    await step('创建并核对本次独立会话', async () => {
      const conversation = await json<{ id: number; planId: number }>('/api/conversations',
        post({ planId: createdPlanId, title: marker }))
      assert(Number.isSafeInteger(conversation.id) && conversation.id > 0)
      conversationId = conversation.id
      assert.equal(conversation.planId, createdPlanId)
      const detail = await json<{ conversation: { planId: number }; messages: unknown[] }>(`/api/conversations/${conversationId}`)
      assert.equal(detail.conversation.planId, createdPlanId)
      assert.deepEqual(detail.messages, [])
    })

    await step('缺少工作区与非法行程返回 400 且不改版本', async () => {
      assert.equal((await request('/api/conversations', post({ title: marker }))).status, 400)
      const response = await request(`/api/plans/${createdPlanId}/save`, post({
        expectedVersion: 1,
        conversationId,
        planJson: { ...initial, days: [{ spots: [{ name: '非法坐标', lng: 181, lat: 0 }] }] },
      }))
      assert.equal(response.status, 400)
      await expectPlan(1, initial)
    })

    await step('无变化保存保持 v1', async () => {
      const result = await json<{ skipped: boolean; version: number }>(`/api/plans/${createdPlanId}/save`,
        post({ expectedVersion: 1, conversationId }))
      assert.equal(result.skipped, true)
      assert.equal(result.version, 1)
      await expectPlan(1, initial)
    })

    await step('保存真实更改和美食、清单字段生成 v2', async () => {
      const result = await json<{ skipped: boolean; version: number }>(`/api/plans/${createdPlanId}/save`,
        post({ planJson: edited, expectedVersion: 1, conversationId }))
      assert.equal(result.skipped, false)
      assert.equal(result.version, 2)
      await expectPlan(2, edited)
      const historical = await json<{ plan: Plan }>(`/api/plans/${createdPlanId}/versions/1`)
      assert.deepEqual(historical.plan, initial, '历史 v1 被覆盖')
    })

    await step('过期保存与切换返回 409 且不更改内容', async () => {
      for (const body of [{ planJson: initial }, { planJson: edited }]) {
        const response = await request(`/api/plans/${createdPlanId}/save`,
          post({ ...body, expectedVersion: 1, conversationId }))
        assert.equal(response.status, 409, '过期保存未被拒绝（包括内容相同的保存）')
      }
      const switched = await request(`/api/plans/${createdPlanId}/switch`,
        post({ version: 1, expectedVersion: 1, conversationId }))
      assert.equal(switched.status, 409, '过期切换未被拒绝')
      await expectPlan(2, edited)
    })

    await step('有效切换直接使用 v1 且不新建版本', async () => {
      const result = await json<{ version: number; switched: boolean; versionId: number }>(
        `/api/plans/${createdPlanId}/switch`,
        post({ version: 1, expectedVersion: 2, conversationId }))
      assert.equal(result.switched, true)
      assert.equal(result.version, 1)
      await expectPlan(1, initial)
      const versions = await json<{ version: number }[]>(`/api/plans/${createdPlanId}/versions`)
      assert.deepEqual(versions.map((version) => version.version), [2, 1], '切换不应新建版本')
      const historical = await json<{ plan: Plan }>(`/api/plans/${createdPlanId}/versions/2`)
      assert.deepEqual(historical.plan, edited, '切换删除或覆盖了历史 v2')
    })

    await step('切换后继续保存形成分叉且消息关联正确', async () => {
      const saved = await json<{ version: number; skipped: boolean }>(`/api/plans/${createdPlanId}/save`,
        post({ planJson: edited, expectedVersion: 1, conversationId }))
      assert.equal(saved.skipped, false)
      assert.equal(saved.version, 3)
      await expectPlan(3, edited)
      const versions = await json<{ id: number; version: number; parentVersionId: number | null }[]>(
        `/api/plans/${createdPlanId}/versions`)
      assert.deepEqual(versions.map((version) => version.version), [3, 2, 1])
      const [v3, v2, v1] = versions
      assert.equal(v3!.parentVersionId, v1!.id, '切换后的新版本应以 v1 为父形成分叉')
      assert.equal(v2!.parentVersionId, v1!.id)
      const detail = await json<{ messages: {
        role: string; content: string; planVersion: number | null;
        preview?: { planId: number; version: number; title: string };
      }[] }>(`/api/conversations/${conversationId}`)
      assert.equal(detail.messages.length, 4, '失败的参数 / 版本检查不应留下额外消息')
      assert(detail.messages.every((message) => message.role === 'system'))
      assert.deepEqual(detail.messages.map((message) => message.preview?.version), [1, 2, 1, 3])
      const switchMessage = detail.messages.find((message) => message.content.includes('已切换到 v1'))
      assert(switchMessage, '未找到切换版本的系统消息')
      assert.equal(switchMessage.planVersion, v1!.id)
      assert.equal(switchMessage.preview?.planId, createdPlanId)
      assert.equal(switchMessage.preview?.version, 1)
      assert.equal(switchMessage.preview?.title, initial.title)
      const branchMessage = detail.messages.find((message) => message.planVersion === v3!.id)
      assert(branchMessage, '未找到分叉版本的系统消息')
    })
  } catch (error) {
    failures += 1
    console.error(`[失败] ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (createdPlanId !== undefined) {
      try {
        await step('仅删除本次临时规划并验证会话级联清理', async () => {
          const response = await request(`/api/plans/${createdPlanId}`, { method: 'DELETE' })
          assert(response.ok, `删除失败 HTTP ${response.status}`)
          assert.equal((await request(`/api/plans/${createdPlanId}`)).status, 404)
          if (conversationId !== undefined) {
            assert.equal((await request(`/api/conversations/${conversationId}`)).status, 404)
          }
        })
      } catch (error) {
        failures += 1
        console.error(`[清理失败] 本次规划 #${createdPlanId}（${marker}）可能需要人工清理；${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  console.log(`[smoke] ${passed} 项通过，${failures} 项失败；未执行 AI、百度或浏览器验收`)
  process.exitCode = failures === 0 ? 0 : 1
}

let config: ReturnType<typeof readConfig> | undefined
try {
  config = readConfig()
} catch (error) {
  console.error(`[配置错误] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
}
if (config) {
  try {
    await run(config)
  } catch (error) {
    console.error(`[运行失败] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

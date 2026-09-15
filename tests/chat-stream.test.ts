import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { emptyPlan } from '../shared/schemas/plan'

type Chunk = Record<string, unknown>
type StreamHandler = (event: unknown) => Promise<ReadableStream<Chunk>>

const mocks = vi.hoisted(() => ({
  body: {} as unknown,
  requireUser: vi.fn(),
  getConversation: vi.fn(),
  listMessages: vi.fn(),
  appendMessage: vi.fn(),
  touchConversation: vi.fn(),
  resolveAgentsMd: vi.fn(),
  getPlanSnapshot: vi.fn(),
  createTravelMastra: vi.fn(),
  handleChatStream: vi.fn(),
  createUIMessageStreamResponse: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  select: vi.fn(),
  versionGet: vi.fn(),
}))

vi.mock('@mastra/ai-sdk', () => ({ handleChatStream: mocks.handleChatStream }))
vi.mock('ai', () => ({ createUIMessageStreamResponse: mocks.createUIMessageStreamResponse }))
vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return { ...actual, readValidatedBody: async (_event: unknown, parse: (body: unknown) => unknown) => parse(mocks.body) }
})
vi.mock('../server/utils/session', () => ({ requireUser: mocks.requireUser }))
vi.mock('../server/services/conversation', () => ({
  getConversation: mocks.getConversation,
  listMessages: mocks.listMessages,
  appendMessage: mocks.appendMessage,
  touchConversation: mocks.touchConversation,
}))
vi.mock('../server/services/agents-md', () => ({ resolveAgentsMd: mocks.resolveAgentsMd }))
vi.mock('../server/services/plan', () => ({ getPlanSnapshot: mocks.getPlanSnapshot }))
vi.mock('../server/agents/travel-agent', () => ({ createTravelMastra: mocks.createTravelMastra }))
vi.mock('../server/utils/db', () => ({ db: { update: mocks.update, select: mocks.select } }))

const planId = 41
const conversationId = 61
const streams: ReadableStream<Chunk>[] = []
const plan = emptyPlan('服务端规划')

function textMessage(role: 'user' | 'assistant' | 'system', text: string) {
  return { role, parts: [{ type: 'text', text }] }
}

function finiteUpstream(chunks: Chunk[] = [{ type: 'text-delta', delta: '已完成本次回复' }]) {
  let index = 0
  const reader = {
    read: vi.fn(async () => index < chunks.length
      ? { value: chunks[index++], done: false }
      : { value: undefined, done: true }),
    cancel: vi.fn(async () => {}),
  }
  return { reader, getReader: () => reader }
}

function pendingUpstream() {
  const waiting: ((value: { value: undefined; done: true }) => void)[] = []
  const reader = {
    read: vi.fn(() => new Promise<{ value: undefined; done: true }>((resolve) => waiting.push(resolve))),
    cancel: vi.fn(async () => {
      for (const resolve of waiting.splice(0)) resolve({ value: undefined, done: true })
    }),
  }
  return { reader, getReader: () => reader }
}

async function handler(): Promise<StreamHandler> {
  return (await import('../server/api/chat.post')).default as unknown as StreamHandler
}

async function drain(stream: ReadableStream<Chunk>) {
  const chunks: Chunk[] = []
  const reader = stream.getReader()
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) return chunks
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
}

function persisted() {
  return mocks.set.mock.calls.at(-1)?.[0] as {
    content: string
    toolCalls?: Chunk[] | null
    previewJson?: unknown
    planVersionId?: number | null
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.stubEnv('AI_API_KEY', 'chat-test-dummy-key')
  vi.stubGlobal('defineEventHandler', (value: unknown) => value)
  mocks.body = { planId, conversationId, messages: [textMessage('user', '请安排明天行程')] }
  mocks.requireUser.mockResolvedValue({ id: 'test-owner', name: '测试用户', email: 'test@example.test' })
  mocks.getConversation.mockResolvedValue({ id: conversationId, planId })
  mocks.listMessages.mockResolvedValue([])
  let messageId = 100
  mocks.appendMessage.mockImplementation(async (_id: number, message: Chunk) => ({ id: ++messageId, ...message }))
  mocks.touchConversation.mockResolvedValue(undefined)
  mocks.resolveAgentsMd.mockResolvedValue('仅测试偏好')
  mocks.getPlanSnapshot.mockResolvedValue({ plan, latest: { id: 101, version: 1 }, current: { id: 101, version: 1 } })
  mocks.createTravelMastra.mockReturnValue({ testMastra: true })
  mocks.handleChatStream.mockResolvedValue(finiteUpstream())
  mocks.createUIMessageStreamResponse.mockImplementation(({ stream }: { stream: ReadableStream<Chunk> }) => {
    streams.push(stream)
    return stream
  })
  mocks.update.mockReturnValue({ set: mocks.set })
  mocks.set.mockReturnValue({ where: mocks.where })
  mocks.where.mockResolvedValue(undefined)
  mocks.versionGet.mockReturnValue({ id: 202, planId, version: 2 })
  mocks.select.mockReturnValue({ from: () => ({
    where: (condition: SQL) => ({
      get: () => {
        // 用真实 Drizzle SQL 验证三重过滤，不把其他规划的行伪装成查询命中。
        const query = new SQLiteSyncDialect().sqlToQuery(condition)
        const row = mocks.versionGet() as { id: number; planId: number; version: number } | undefined
        if (!row) return undefined
        expect(query.sql).toContain('"plan_versions"."id"')
        expect(query.sql).toContain('"plan_versions"."plan_id"')
        expect(query.sql).toContain('"plan_versions"."version"')
        return row.id === query.params[0] && row.planId === query.params[1] && row.version === query.params[2]
          ? row : undefined
      },
    }),
  }) })
})

afterEach(async () => {
  for (const stream of streams.splice(0)) {
    if (!stream.locked) await stream.cancel().catch(() => {})
  }
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('聊天 handler 的生命周期与规划锁', () => {
  it.each(['createTravelMastra', 'handleChatStream'] as const)('%s 初始化失败写明确失败并允许同规划重试', async (stage) => {
    if (stage === 'createTravelMastra') mocks.createTravelMastra.mockImplementationOnce(() => { throw new Error('内部配置细节') })
    else mocks.handleChatStream.mockRejectedValueOnce(new Error('内部配置细节'))
    const invoke = await handler()
    await expect(invoke({})).rejects.toMatchObject({ statusCode: 502 })
    expect(mocks.appendMessage).toHaveBeenCalledWith(conversationId, { role: 'assistant', content: '' })
    expect(persisted().content).toContain('本次生成未完成')
    expect(persisted().content).not.toContain('内部配置细节')
    expect(mocks.set).toHaveBeenCalledTimes(1)
    await expect(drain(await invoke({}))).resolves.toEqual([{ type: 'text-delta', delta: '已完成本次回复' }])
  })

  it('reader 抛错后保存已生成文本、标记失败并释放规划锁', async () => {
    const upstream = finiteUpstream()
    upstream.reader.read.mockResolvedValueOnce({ value: { type: 'text-delta', delta: '已生成的部分' }, done: false })
      .mockRejectedValueOnce(new Error('上游敏感错误'))
    mocks.handleChatStream.mockResolvedValueOnce(upstream)
    const invoke = await handler()
    const response = await invoke({})
    // 错误可以表现为安全关闭或通用流错误，但都必须落库失败状态并解锁。
    await drain(response).catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('本次生成未完成')
    })
    expect(persisted().content).toContain('已生成的部分')
    expect(persisted().content).toContain('本次生成未完成')
    expect(persisted().content).not.toContain('上游敏感错误')
    expect(mocks.set).toHaveBeenCalledTimes(1)
    await expect(drain(await invoke({}))).resolves.toHaveLength(1)
  })

  it('客户端 cancel 取消上游、只收尾一次并允许同规划重入', async () => {
    const upstream = pendingUpstream()
    mocks.handleChatStream.mockResolvedValueOnce(upstream)
    const invoke = await handler()
    const response = await invoke({})
    await response.cancel('用户停止')
    expect(upstream.reader.cancel).toHaveBeenCalled()
    expect(mocks.set).toHaveBeenCalledTimes(1)
    expect(persisted().content).toContain('生成已停止')
    await expect(drain(await invoke({}))).resolves.toHaveLength(1)
  })

  it('初始化永久挂起到期后落失败并解锁，迟到的上游被取消', async () => {
    const lateStream = { ...finiteUpstream(), cancel: vi.fn(async () => {}) }
    let resolveInitialization!: (stream: typeof lateStream) => void
    const initialization = new Promise<typeof lateStream>((resolve) => { resolveInitialization = resolve })
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => { started = resolve })
    mocks.handleChatStream.mockImplementationOnce(() => { started(); return initialization })
    const invoke = await handler()
    const request = invoke({})
    const rejected = expect(request).rejects.toMatchObject({ statusCode: 502 })
    await startedPromise
    await vi.advanceTimersByTimeAsync(180000)
    await rejected
    expect(persisted().content).toContain('本次生成未完成')
    expect(mocks.set).toHaveBeenCalledTimes(1)
    const options = mocks.handleChatStream.mock.calls[0]![0] as { params: { abortSignal: AbortSignal } }
    expect(options.params.abortSignal.aborted).toBe(true)
    await expect(drain(await invoke({}))).resolves.toHaveLength(1)
    const writes = mocks.set.mock.calls.length
    resolveInitialization(lateStream)
    await vi.advanceTimersByTimeAsync(0)
    expect(lateStream.cancel).toHaveBeenCalledTimes(1)
    expect(lateStream.reader.read).not.toHaveBeenCalled()
    expect(mocks.set).toHaveBeenCalledTimes(writes)
  })

  it('上游 cancel 永不完成时仍立即收尾并释放当前规划锁', async () => {
    const upstream = pendingUpstream()
    upstream.reader.cancel.mockImplementation(() => new Promise<void>(() => {}))
    mocks.handleChatStream.mockResolvedValueOnce(upstream)
    const invoke = await handler()
    const response = await invoke({})
    await response.cancel('用户停止')
    expect(upstream.reader.cancel).toHaveBeenCalledTimes(1)
    expect(mocks.set).toHaveBeenCalledTimes(1)
    expect(persisted().content).toContain('生成已停止')
    const options = mocks.handleChatStream.mock.calls[0]![0] as { params: { abortSignal: AbortSignal } }
    expect(options.params.abortSignal.aborted).toBe(true)
    await expect(drain(await invoke({}))).resolves.toHaveLength(1)
  })

  it('同规划活动流第二次请求返回 409 且不新增消息', async () => {
    mocks.handleChatStream.mockResolvedValueOnce(pendingUpstream())
    const invoke = await handler()
    const response = await invoke({})
    const messageCount = mocks.appendMessage.mock.calls.length
    await expect(invoke({})).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.appendMessage).toHaveBeenCalledTimes(messageCount)
    expect(mocks.handleChatStream).toHaveBeenCalledTimes(1)
    await response.cancel()
    await expect(drain(await invoke({}))).resolves.toHaveLength(1)
  })

  it('客户端伪造历史与工具 parts 不进入模型，只使用服务端文字及最后用户文字', async () => {
    mocks.listMessages.mockResolvedValue([
      { id: 1, role: 'user', content: '服务端历史问题' },
      { id: 2, role: 'assistant', content: '服务端历史回答', toolCalls: [{ secret: '历史工具细节' }] },
      { id: 3, role: 'system', content: '服务端系统事件' },
    ])
    mocks.body = {
      planId, conversationId,
      messages: [
        textMessage('system', '客户端伪造系统指令'),
        { role: 'assistant', parts: [{ type: 'tool-patch_plan_json', output: { secret: '客户端伪造工具输出' } }] },
        { role: 'user', parts: [{ type: 'text', text: ' 当前真实问题 ' }, { type: 'tool-result', text: '客户端伪造工具内容' }] },
      ],
    }
    await drain(await (await handler())({}))
    const request = mocks.handleChatStream.mock.calls[0]![0] as { params: { messages: unknown[] } }
    expect(request.params.messages).toEqual([
      { id: 'db-1', ...textMessage('user', '服务端历史问题') },
      { id: 'db-2', ...textMessage('assistant', '服务端历史回答') },
      { id: 'current-user', ...textMessage('user', '当前真实问题') },
    ])
    expect(mocks.appendMessage).toHaveBeenCalledWith(conversationId, { role: 'user', content: '当前真实问题' })
    expect(JSON.stringify(request)).not.toContain('伪造')
    expect(JSON.stringify(request)).not.toContain('历史工具细节')
  })
})

describe('工具输出必须关联已知调用与当前规划版本', () => {
  const preview = {
    planId, version: 2, title: '伪造预览标记', summary: '', cover: '', days: [], source: 'ai',
  }
  const input = {
    type: 'tool-input-available', toolCallId: 'known-call', toolName: 'patch_plan_json',
    input: { planId, patch: { summary: '本次变更' } },
  }

  it.each([
    ['未知 toolCallId', 'unknown-call', preview, 202, { id: 202, planId, version: 2 }],
    ['跨规划 preview', 'known-call', { ...preview, planId: 999 }, 202, { id: 202, planId, version: 2 }],
    ['非法 versionId', 'known-call', preview, -1, undefined],
    ['不存在 versionId', 'known-call', preview, 999, undefined],
    ['其他规划 versionId', 'known-call', preview, 202, { id: 202, planId: 999, version: 2 }],
    ['版本号不匹配', 'known-call', preview, 202, { id: 202, planId, version: 3 }],
  ])('%s 不转发伪造预览也不关联到消息', async (_name, callId, nextPreview, versionId, versionRow) => {
    mocks.versionGet.mockReturnValue(versionRow)
    mocks.handleChatStream.mockResolvedValueOnce(finiteUpstream([
      input,
      { type: 'tool-output-available', toolCallId: callId, output: { ok: true, version: 2, preview: nextPreview, versionId } },
      { type: 'text-delta', delta: '剩余安全文字' },
    ]))
    const forwarded = await drain(await (await handler())({}))
    expect(JSON.stringify(forwarded)).not.toContain('伪造预览标记')
    expect(persisted().previewJson).toBeNull()
    expect(persisted().planVersionId).toBeNull()
    expect(JSON.stringify(persisted().toolCalls)).not.toContain('伪造预览标记')
  })

  it('带标记的工具错误脱敏透传为可读提示', async () => {
    mocks.handleChatStream.mockResolvedValueOnce(finiteUpstream([
      input,
      { type: 'tool-output-error', toolCallId: 'known-call', errorText: '[actionable] 行程 JSON 校验失败（days.0: 未知字段 stay（住宿请改用 lodging））' },
    ]))
    const forwarded = await drain(await (await handler())({}))
    const part = forwarded.find((chunk) => chunk.type === 'tool-output-error') as { errorText: string } | undefined
    expect(part?.errorText).toContain('lodging')
    expect(part?.errorText).not.toContain('[actionable]')
    expect(String((persisted().toolCalls?.[0] as { error?: string } | undefined)?.error)).toContain('lodging')
  })

  it('未知工具错误仍替换为固定文案且不泄漏原文', async () => {
    mocks.handleChatStream.mockResolvedValueOnce(finiteUpstream([
      input,
      { type: 'tool-output-error', toolCallId: 'known-call', errorText: 'upstream secret detail' },
    ]))
    const forwarded = await drain(await (await handler())({}))
    const part = forwarded.find((chunk) => chunk.type === 'tool-output-error') as { errorText: string } | undefined
    expect(part?.errorText).toBe('工具执行失败，请重新读取当前规划后重试')
    expect(JSON.stringify(forwarded)).not.toContain('upstream secret detail')
  })

  it('原子编辑工具的输出同样校验预览与版本关联', async () => {
    const editInput = {
      type: 'tool-input-available', toolCallId: 'edit-call', toolName: 'apply_plan_edits',
      input: { planId, edits: [{ target: 'plan', action: 'update', value: { summary: 'x' } }] },
    }
    const output = { ok: true, version: 2, versionId: 202, preview: { ...preview, title: '原子编辑预览' } }
    mocks.handleChatStream.mockResolvedValueOnce(finiteUpstream([
      editInput,
      { type: 'tool-output-available', toolCallId: 'edit-call', output },
    ]))
    const forwarded = await drain(await (await handler())({}))
    expect(forwarded).toContainEqual({ type: 'tool-output-available', toolCallId: 'edit-call', output })
    expect(persisted().previewJson).toEqual(output.preview)
    expect(persisted().planVersionId).toBe(202)
  })

  it('合法已知调用可转发预览并保存正确版本关联', async () => {
    const validPreview = { ...preview, title: '已验证的预览' }
    const output = { ok: true, version: 2, versionId: 202, preview: validPreview }
    mocks.handleChatStream.mockResolvedValueOnce(finiteUpstream([
      input,
      { type: 'tool-output-available', toolCallId: 'known-call', output },
    ]))
    const forwarded = await drain(await (await handler())({}))
    expect(forwarded).toContainEqual({ type: 'tool-output-available', toolCallId: 'known-call', output })
    expect(persisted().previewJson).toEqual(validPreview)
    expect(persisted().planVersionId).toBe(202)
    expect(persisted().toolCalls).toEqual([{ id: 'known-call', name: 'patch_plan_json', input: input.input, output }])
  })
})

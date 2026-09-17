import type { LanguageModelV2, LanguageModelV2StreamPart } from '@ai-sdk/provider'
import { handleChatStream, toAISdkV5Stream } from '@mastra/ai-sdk'
import { Agent } from '@mastra/core/agent'
import { Mastra } from '@mastra/core/mastra'
import { isValidationError } from '@mastra/core/tools'
import { createError } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyPlan } from '../shared/schemas/plan'
import { createPlanTools } from '../server/agents/tools'
import { toolInputError } from '../server/agents/tool-inputs'
import { extractActionable, preserveActionableError } from '../server/utils/errors'

const mocks = vi.hoisted(() => ({
  getPlanSnapshot: vi.fn(),
  applyPlanEdits: vi.fn(),
  patchPlan: vi.fn(),
}))

// Keep the real Mastra tools, model loop and AI SDK adapter; isolate all I/O.
vi.mock('../server/services/plan', () => mocks)
vi.mock('../server/services/baidu', () => ({ getPanoramaImage: vi.fn() }))
vi.mock('../server/services/poi', () => ({ searchPlanPlaces: vi.fn() }))

const planId = 41
const plan = emptyPlan('离线行程')
const failure = '本次生成未完成'
const preview = {
  planId, version: 2, title: plan.title, summary: '', cover: '', days: [], source: 'ai',
}
const editInput = {
  planId,
  edits: [{ target: 'plan', action: 'update', value: { summary: '离线编辑' } }],
}

function modelCalling(toolName: string, input: unknown): LanguageModelV2 {
  return {
    specificationVersion: 'v2', provider: 'offline', modelId: 'offline', supportedUrls: {},
    doGenerate: async () => { throw new Error('This test only supports streaming') },
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV2StreamPart>({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          controller.enqueue({ type: 'tool-call', toolCallId: 'offline-call', toolName, input: JSON.stringify(input) })
          controller.enqueue({ type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1 } })
          controller.close()
        },
      }),
    }),
  }
}

async function runTool(toolName: string, input: unknown, directAdapter = false) {
  const agent = new Agent({
    id: 'offline-agent', name: '离线测试', instructions: '仅测试工具协议',
    model: modelCalling(toolName, input),
    tools: createPlanTools({ userId: 'offline-owner', planId, conversationId: 61, assistantMessageId: 101 }),
  })
  const mastra = new Mastra({ agents: { 'offline-agent': agent }, logger: false })
  const onError = (error: unknown) => preserveActionableError(error) ?? failure
  const messages = [{ id: 'offline-user', role: 'user' as const, parts: [{ type: 'text' as const, text: '执行离线工具测试' }] }]
  const stream = directAdapter
    ? toAISdkV5Stream(await agent.stream(messages, { maxSteps: 1 }), { from: 'agent', onError })
    : await handleChatStream({
      mastra, agentId: 'offline-agent', version: 'v5', onError,
      params: { messages, maxSteps: 1 },
    })
  const chunks: Record<string, unknown>[] = []
  for await (const chunk of stream) chunks.push(chunk as unknown as Record<string, unknown>)
  return chunks
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getPlanSnapshot.mockResolvedValue({ plan, row: { revision: 1 }, current: { id: 201, version: 1 } })
  mocks.applyPlanEdits.mockResolvedValue({
    version: 2, revision: 2, versionId: 202, diff: [{ path: 'summary' }], skipped: false, preview,
  })
})

describe('真实 Mastra 工具与 AI SDK v5 离线集成', () => {
  it('执行侧跟踪修订号；冲突后必须读取，连续编辑使用最新修订号', async () => {
    const tools = createPlanTools({ userId: 'offline-owner', planId, conversationId: 61, assistantMessageId: 101, revision: 1 })
    const edit = tools.apply_plan_edits.execute as (input: typeof editInput) => Promise<unknown>
    const read = tools.get_plan.execute as (input: { planId: number }) => Promise<unknown>
    await edit(editInput)
    expect(mocks.applyPlanEdits.mock.calls[0]?.[3]).toMatchObject({ expectedRevision: 1 })
    mocks.applyPlanEdits.mockRejectedValueOnce(createError({ statusCode: 409, statusMessage: '数据已更新，请重读' }))
    await expect(edit(editInput)).rejects.toThrow('数据已更新')
    expect(mocks.applyPlanEdits.mock.calls[1]?.[3]).toMatchObject({ expectedRevision: 2 })
    await expect(edit(editInput)).rejects.toThrow('get_plan')
    expect(mocks.applyPlanEdits).toHaveBeenCalledTimes(2)
    mocks.getPlanSnapshot.mockResolvedValueOnce({ plan, row: { revision: 7 }, current: { id: 201, version: 1 } })
    await read({ planId })
    await edit(editInput)
    expect(mocks.applyPlanEdits.mock.calls[2]?.[3]).toMatchObject({ expectedRevision: 7 })
  })

  it('缺少 planId 时框架返回校验结果而非抛错，业务服务不会执行', async () => {
    const chunks = await runTool('apply_plan_edits', {})
    const output = chunks.find((chunk) => chunk.type === 'tool-output-available')?.output
    expect(isValidationError(output)).toBe(true)
    expect(output).toMatchObject({ error: true, validationErrors: { fields: { planId: expect.any(Object), edits: expect.any(Object) } } })
    expect(chunks.some((chunk) => chunk.type === 'tool-output-error')).toBe(false)
    expect(mocks.applyPlanEdits).not.toHaveBeenCalled()
    expect(toolInputError('apply_plan_edits', {})).toContain('planId')
    expect(toolInputError('apply_plan_edits', {})).toContain('edits')
  })

  it('合法 get_plan 参数按当前 Mastra execute(input) 签名读取并返回规划', async () => {
    const chunks = await runTool('get_plan', { planId })
    expect(mocks.getPlanSnapshot).toHaveBeenCalledWith('offline-owner', planId)
    expect(chunks).toContainEqual({
      type: 'tool-output-available', toolCallId: 'offline-call',
      output: { ok: true, planId, version: 1, revision: 1, plan },
    })
  })

  it('合法编辑参数通过工具与输出校验，返回版本和预览', async () => {
    const chunks = await runTool('apply_plan_edits', editInput)
    expect(mocks.applyPlanEdits).toHaveBeenCalledWith('offline-owner', planId, editInput.edits, {
      messageId: 101, expectedVersion: undefined, expectedRevision: 1,
    })
    expect(chunks).toContainEqual({
      type: 'tool-output-available', toolCallId: 'offline-call',
      output: { ok: true, version: 2, revision: 2, versionId: 202, changed: 1, skipped: false, preview },
    })
  })

  it.each([false, true])('业务 400 错误在真实 SDK 包装后保留可操作提示（直接转换器：%s）', async (directAdapter) => {
    const detail = '行程 JSON 校验失败（days.0.meals: 请使用字符串数组）'
    mocks.applyPlanEdits.mockRejectedValue(createError({ statusCode: 400, statusMessage: detail }))
    const chunks = await runTool('apply_plan_edits', editInput, directAdapter)
    const error = chunks.find((chunk) => chunk.type === 'tool-output-error')
    expect(extractActionable(error?.errorText)).toBe(detail)
    expect(error?.errorText).not.toBe(failure)
  })

  it.each(['dummy-secret', '[actionable] dummy-secret'])('未知错误不得借文案伪装为可信提示：%s', async (message) => {
    mocks.applyPlanEdits.mockRejectedValue(new Error(message))
    const chunks = await runTool('apply_plan_edits', editInput)
    expect(chunks.find((chunk) => chunk.type === 'tool-output-error')?.errorText).toBe(failure)
    expect(JSON.stringify(chunks)).not.toContain('dummy-secret')
  })
})

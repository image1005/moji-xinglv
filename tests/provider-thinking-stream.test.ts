import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agent } from '@mastra/core/agent'
import { Mastra } from '@mastra/core/mastra'
import { createTool } from '@mastra/core/tools'
import { handleChatStream } from '@mastra/ai-sdk'
import { z } from 'zod'
import { createConfiguredModel } from '../server/providers/models'
import type { ModelConfiguration } from '../shared/schemas/model-config'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

function sse(deltas: Record<string, unknown>[], finishReason = 'stop') {
  const chunks = deltas.map(delta => ({ id: 'thinking-fixture', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta, finish_reason: null as string | null }] }))
  chunks.push({ id: 'thinking-fixture', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })
  return new Response(`${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
}

async function collect(thinking: ModelConfiguration['thinking'], webSearch: boolean, sendReasoning: boolean | null = true) {
  const model = createConfiguredModel({ model: 'deepseek-flash', thinking, webSearch })
  if ('id' in model) throw new Error('Unexpected provider')
  const confirm = createTool({ id: 'confirm', description: 'Confirm the current plan.', inputSchema: z.object({ planId: z.number() }), execute: async ({ planId }) => ({ planId, confirmed: true }) })
  const search = createTool({ id: 'search_web', description: 'Search when enabled.', inputSchema: z.object({ query: z.string() }), execute: async () => ({ sources: [] }) })
  const agent = new Agent({ id: 'thinking-fixture', name: 'thinking fixture', instructions: 'Use confirm then respond.', model, tools: { confirm, ...(webSearch ? { search_web: search } : {}) } })
  const mastra = new Mastra({ agents: { 'thinking-fixture': agent }, logger: false })
  const stream = await handleChatStream({ mastra, agentId: 'thinking-fixture', version: 'v5', ...(sendReasoning === null ? {} : { sendReasoning }), params: { messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Confirm plan 41.' }] }], maxSteps: 3, modelSettings: { maxOutputTokens: 4096, maxRetries: 0 } } })
  const chunks: Record<string, unknown>[] = []
  for await (const part of stream) chunks.push(part as unknown as Record<string, unknown>)
  return chunks
}

describe('隔离供应商流：实际 SDK 与 Mastra 思考工具往返', () => {
  it.each(['off', 'light', 'standard', 'deep'] as const)('保留 %s 档思考、正文和工具续传；搜索开关独立', async (thinking) => {
    vi.stubEnv('AI_PROVIDER', 'deepseek'); vi.stubEnv('AI_API_KEY', 'fixture-only'); vi.stubEnv('AI_BASE_URL', 'https://api.deepseek.com/v1')
    for (const webSearch of [false, true]) {
      const bodies: Record<string, unknown>[] = []
      vi.stubGlobal('fetch', async (_url: unknown, request: RequestInit) => {
        const body = JSON.parse(String(request.body))
        bodies.push(body)
        return bodies.length === 1
          ? sse([...(thinking === 'off' ? [] : [{ reasoning_content: 'fixture reasoning before tool' }]), { content: '正在核对。' }, { tool_calls: [{ index: 0, id: 'confirm-41', type: 'function', function: { name: 'confirm', arguments: '{"planId":41}' } }] }], 'tool_calls')
          : webSearch && bodies.length === 2
            ? sse([...(thinking === 'off' ? [] : [{ reasoning_content: 'fixture reasoning before tool' }]), { tool_calls: [{ index: 0, id: 'search-41', type: 'function', function: { name: 'search_web', arguments: '{"query":"travel"}' } }] }], 'tool_calls')
          : sse([...(thinking === 'off' ? [] : [{ reasoning_content: 'fixture reasoning after tool' }]), { content: '已核对，正文完成。' }])
      })
      const chunks = await collect(thinking, webSearch)
      expect(bodies).toHaveLength(webSearch ? 3 : 2)
      for (const body of bodies) {
        expect(body.thinking).toEqual({ type: thinking === 'off' ? 'disabled' : 'enabled' })
        expect(body.reasoning_effort).toBe(thinking === 'off' ? undefined : { light: 'low', standard: 'high', deep: 'max' }[thinking])
        expect((body.tools as Array<{ function: { name: string } }>).some(tool => tool.function.name === 'search_web')).toBe(webSearch)
      }
      const messages = bodies[1]!.messages as Array<Record<string, unknown>>
      expect(messages.find(message => message.role === 'assistant' && message.tool_calls)).toMatchObject({ content: '正在核对。', reasoning_content: thinking === 'off' ? '' : 'fixture reasoning before tool' })
      expect(messages.find(message => message.role === 'tool')).toMatchObject({ tool_call_id: 'confirm-41' })
      if (webSearch && thinking !== 'off') {
        const lastMessages = bodies.at(-1)!.messages as Array<Record<string, unknown>>
        expect(lastMessages.filter(message => message.role === 'assistant' && message.tool_calls).map(message => message.reasoning_content)).toEqual(['fixture reasoning before tool', 'fixture reasoning before tool'])
      }
      expect(chunks.find(part => part.type === 'tool-output-available')).toMatchObject({ toolCallId: 'confirm-41', output: { confirmed: true, planId: 41 } })
      expect(chunks.filter(part => part.type === 'text-delta').map(part => part.delta).join('')).toBe('正在核对。已核对，正文完成。')
      expect(chunks.filter(part => part.type === 'reasoning-delta').map(part => part.delta).join('')).toBe(thinking === 'off' ? '' : `fixture reasoning before tool${webSearch ? 'fixture reasoning before tool' : ''}fixture reasoning after tool`)
      expect(chunks.find(part => part.type === 'error')).toBeUndefined()
      expect(chunks.at(-1)).toMatchObject({ type: 'finish', finishReason: 'stop' })
    }
  })
  it('复现 Mastra 默认隐藏思考流；显式启用才向客户端传递活动', async () => {
    vi.stubEnv('AI_PROVIDER', 'deepseek'); vi.stubEnv('AI_API_KEY', 'fixture-only'); vi.stubEnv('AI_BASE_URL', 'https://api.deepseek.com/v1')
    vi.stubGlobal('fetch', async () => sse([{ reasoning_content: 'still thinking' }, { content: '完成。' }]))
    const hidden = await collect('deep', false, null)
    expect(hidden.some(part => part.type === 'reasoning-delta')).toBe(false)
    const visible = await collect('deep', false)
    expect(visible.find(part => part.type === 'reasoning-delta')).toMatchObject({ delta: 'still thinking' })
    expect(visible.find(part => part.type === 'text-delta')).toMatchObject({ delta: '完成。' })
  })
  it('恢复被去重的真实思考后重新计入上限，不能绕过续传额度', async () => {
    vi.stubEnv('AI_PROVIDER', 'deepseek'); vi.stubEnv('AI_API_KEY', 'fixture-only'); vi.stubEnv('AI_BASE_URL', 'https://api.deepseek.com/v1')
    vi.stubEnv('AI_REASONING_MAX_BYTES', '1024')
    let requests = 0
    vi.stubGlobal('fetch', async () => {
      requests++
      return sse([{ reasoning_content: 'r'.repeat(700) }, { tool_calls: [{ index: 0, id: `budget-${requests}`, type: 'function', function: { name: 'confirm', arguments: '{"planId":41}' } }] }], 'tool_calls')
    })
    const chunks = await collect('deep', false)
    expect(requests).toBe(2)
    expect(chunks.some(part => part.type === 'error')).toBe(true)
  })
  it('新运行即使收到重复工具ID，也不能复用上一运行的思考或补造缺失内容', async () => {
    vi.stubEnv('AI_PROVIDER', 'deepseek'); vi.stubEnv('AI_API_KEY', 'fixture-only'); vi.stubEnv('AI_BASE_URL', 'https://api.deepseek.com/v1')
    const bodies: Array<{ messages: Array<Record<string, unknown>> }> = []
    vi.stubGlobal('fetch', async (_url: unknown, request: RequestInit) => {
      bodies.push(JSON.parse(String(request.body)))
      return bodies.length % 2
        ? sse([...(bodies.length === 1 ? [{ reasoning_content: 'first run only' }] : []), { tool_calls: [{ index: 0, id: 'same-call-id', type: 'function', function: { name: 'confirm', arguments: '{"planId":41}' } }] }], 'tool_calls')
        : sse([{ content: '完成。' }])
    })
    await collect('deep', false)
    await collect('deep', false)
    expect(bodies).toHaveLength(4)
    expect(bodies[1]!.messages.find(message => message.role === 'assistant')).toMatchObject({ reasoning_content: 'first run only' })
    expect(bodies[3]!.messages.find(message => message.role === 'assistant')).toMatchObject({ reasoning_content: '' })
  })
})

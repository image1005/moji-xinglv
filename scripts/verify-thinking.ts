/** Opt-in real provider acceptance through the application's complete chat entry, on disposable data. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import type { H3Event } from 'h3'
import type { ModelConfiguration } from '../shared/schemas/model-config'
import { isVersionNameRequest } from './model-verification'

assert(process.argv.includes('--real'), 'Pass --real to run billable provider verification')
assert(process.env.AI_API_KEY, 'AI_API_KEY is required')
const root = await realpath(tmpdir())
const directory = await mkdtemp(join(root, 'shanhai-thinking-'))
process.env.DATABASE_URL = `file:${join(directory, 'probe.db').replaceAll('\\', '/')}`
const artifacts = resolve('.verification/thinking-real', new Date().toISOString().replace(/[:.]/g, '-'))
await mkdir(artifacts, { recursive: true })
const selected = process.argv.find(arg => arg.startsWith('--thinking='))?.slice(11)
const search = process.argv.includes('--search')
const planning = process.argv.includes('--planning')
const results: object[] = []
let close: (() => void) | undefined
let settleNaming: (() => Promise<unknown>) | undefined
try {
  await import('../server/database/migrate')
  const { db } = await import('../server/utils/db')
  close = () => db.$client.close()
  const schema = await import('../server/database/schema')
  const { eq } = await import('drizzle-orm')
  const { createPlan, getPlanSnapshot } = await import('../server/services/plan')
  const { createConversation } = await import('../server/services/conversation')
  const { executeChat } = await import('../server/services/chat-application')
  const { configuredModel, modelCapabilities } = await import('../server/providers/models')
  const { saveModelSettings, getModelSettings } = await import('../server/services/model-settings')
  const user = { id: crypto.randomUUID(), name: '隔离思考验证', email: `${crypto.randomUUID()}@example.invalid` }
  db.insert(schema.user).values({ ...user, createdAt: new Date(), updatedAt: new Date() }).run()
  const namingDeadlines = new Map<number, number>()
  async function waitForNames(planId?: number) {
    // Naming has a 15s AbortSignal deadline. Keep SQLite open through successful writeback,
    // or through that deadline plus a bounded settling margin when the provider fails.
    while (true) {
      const versions = db.select({ id: schema.planVersions.id, version: schema.planVersions.version, name: schema.planVersions.name,
        nameSource: schema.planVersions.nameSource, nameRevision: schema.planVersions.nameRevision }).from(schema.planVersions)
        .where(planId === undefined ? undefined : eq(schema.planVersions.planId, planId)).all()
      const pending = versions.filter(version => version.nameSource !== 'ai' && version.nameSource !== 'user')
      for (const version of pending) if (!namingDeadlines.has(version.id)) namingDeadlines.set(version.id, Date.now() + 17000)
      if (pending.every(version => Date.now() >= namingDeadlines.get(version.id)!)) return versions
      await Bun.sleep(50)
    }
  }
  settleNaming = () => waitForNames()
  const levels = modelCapabilities().thinkingLevels.filter(level => !selected || level === selected)
  assert(levels.length, 'Selected thinking level is unavailable')
  for (const thinking of levels) {
    const created = await createPlan(user.id, { title: '隔离思考链路验证' })
    const initialNaming = await waitForNames(created.planId)
    const conversation = await createConversation(user.id, created.planId)
    for (let turn = 1; turn <= (process.argv.includes('--followup') ? 2 : 1); turn++) {
    const configuration: ModelConfiguration = { model: configuredModel(), thinking, webSearch: search }
    saveModelSettings(user.id, configuration)
    const snapshot = getModelSettings(user.id).defaults
    assert.equal(snapshot.thinking, thinking)
    assert.equal(snapshot.webSearch, search)
    const requestId = crypto.randomUUID()
    const start = Date.now()
    let terminal: string | undefined, textChars = 0, reasoningChars = 0, upstreamReasoningChars = 0, errors = 0, sources = 0
    const calls: string[] = []
    const failureMessages: string[] = []
    const wire: object[] = []
    let naming: Awaited<ReturnType<typeof waitForNames>> = []
    const realFetch = globalThis.fetch
    globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      let kind: 'chat' | 'version-name' | 'other' = 'other'
      if (typeof init?.body === 'string' && String(input).includes('/chat/completions')) {
        const body = JSON.parse(init.body)
        kind = isVersionNameRequest(body) ? 'version-name' : 'chat'
        wire.push({ kind, model: body.model, thinking: body.thinking, effort: body.reasoning_effort, maxTokens: body.max_tokens,
          assistantReasoningLengths: body.messages?.filter((m: { role: string }) => m.role === 'assistant').map((m: { reasoning_content?: string }) => m.reasoning_content?.length ?? null) })
      }
      try {
        const response = await realFetch(input, init)
        const metadata: { kind: typeof kind; httpStatus: number; finishReasons: string[]; outputTokens?: number; reasoningTokens?: number } = { kind, httpStatus: response.status, finishReasons: [] }
        wire.push(metadata)
        if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response
        let pending = ''
        const decoder = new TextDecoder()
        return new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
          pending += decoder.decode(chunk, { stream: true })
          let newline: number
          while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1)
            if (!line.startsWith('data:') || line.includes('[DONE]')) continue
            try {
              const data = JSON.parse(line.slice(5))
              for (const choice of data.choices ?? []) {
                if (kind === 'chat') upstreamReasoningChars += choice.delta?.reasoning_content?.length ?? 0
                if (choice.finish_reason) metadata.finishReasons.push(choice.finish_reason)
              }
              if (data.usage) { metadata.outputTokens = data.usage.completion_tokens; metadata.reasoningTokens = data.usage.completion_tokens_details?.reasoning_tokens }
            } catch { /* SDK owns protocol validation; this only collects counters. */ }
          }
          controller.enqueue(chunk)
        } })), { status: response.status, headers: response.headers })
      } catch (error) {
        wire.push({ kind, networkError: error instanceof Error ? error.name : 'Error', code: (error as { code?: string }).code })
        throw error
      }
    }, realFetch)
    try {
      const messageId = crypto.randomUUID()
      const response = await executeChat({} as H3Event, user, {
        protocolVersion: 1, type: 'message', requestId, messageId, planId: created.planId, conversationId: conversation.id,
        configuration: snapshot, message: { id: messageId, role: 'user', parts: [{ type: 'text', text: planning
          ? '请直接保存北京七天旅行行程，每天四个景点，并推荐七道美食和行前清单。每日安排需仔细考虑顺路、体力分配和饮食搭配，分批完成，最后简短总结。无需追问。'
          : search
          ? '请先联网检索杭州西湖旅行资料，再读取当前规划，最后用一句话说明你查询和读取的结果。不要修改行程。'
          : '请先读取当前规划，认真核对其内容，然后用一句话说明该规划目前有没有安排日程。不要修改行程。' }] },
      })
      const { readJsonLines } = await import('../shared/utils/jsonl')
      for await (const raw of readJsonLines(response.body!)) {
        const event = raw as { type: string; status?: string; message?: string; chunk?: { type: string; delta?: string; errorText?: string; toolName?: string; output?: { sources?: unknown[] } } }
        if (event.type === 'terminal') terminal = event.status
        if (event.type === 'error' || event.chunk?.type === 'error' || event.chunk?.type === 'tool-output-error') errors++
        // executeChat has already reduced these to fixed or actionable application messages.
        if (event.message || event.chunk?.errorText) failureMessages.push(event.message ?? event.chunk!.errorText!)
        if (event.chunk?.type === 'text-delta') textChars += event.chunk.delta?.length ?? 0
        if (event.chunk?.type === 'reasoning-delta') reasoningChars += event.chunk.delta?.length ?? 0
        if (event.chunk?.type === 'tool-input-available') calls.push(event.chunk.toolName!)
        if (event.chunk?.type === 'tool-output-available') sources += event.chunk.output?.sources?.length ?? 0
      }
    } catch (error) {
      errors++
      terminal = `request-error:${error instanceof Error ? error.name : 'unknown'}`
    } finally {
      try { naming = await waitForNames(created.planId) }
      finally { globalThis.fetch = realFetch }
    }
    const run = db.select().from(schema.chatRuns).where(eq(schema.chatRuns.requestId, requestId)).get()
    const current = await getPlanSnapshot(user.id, created.planId)
    const planStats = { days: current.plan.days.length, spots: current.plan.days.reduce((n, day) => n + day.spots.length, 0), foods: current.plan.foodJournal.length, checklist: current.plan.checklist.length }
    const expectedEffort = { off: undefined, light: 'low', standard: 'high', deep: 'max' }[thinking]
    const chatRequests = wire.filter(value => 'model' in value && 'kind' in value && value.kind === 'chat')
    const paramsCorrect = chatRequests.length > 0 && chatRequests.every(value => {
      const request = value as { effort?: string; thinking?: { type: string } }
      return request.effort === expectedEffort && request.thinking?.type === (thinking === 'off' ? 'disabled' : 'enabled')
    })
    const chatPassed = terminal === 'completed' && run?.status === 'completed' && textChars > 0 && errors === 0 && paramsCorrect && (planning ? planStats.days === 7 && planStats.spots >= 28 && planStats.foods >= 7 && planStats.checklist > 0 : calls.includes('get_plan')) && (thinking === 'off' || upstreamReasoningChars > 0 && reasoningChars > 0) && (!search || calls.includes('search_web') && sources > 0)
    const namingPassed = [...initialNaming, ...naming].every(version => version.nameSource === 'ai' && !!version.name)
    const result = { mode: 'real-provider', scenario: planning ? 'planning' : 'read-tool', turn, configuration: snapshot, passed: chatPassed && namingPassed, chatPassed, namingPassed, naming,
      durationMs: Date.now() - start, terminal, persistedStatus: run?.status, persistedError: run?.errorCode, textChars, reasoningChars, upstreamReasoningChars, tools: calls, sources, errors, failureMessages, paramsCorrect, planStats, wire }
    results.push(result)
    console.log(JSON.stringify(result))
    await Bun.write(join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
    }
  }
  assert(results.every(result => (result as { passed: boolean }).passed), 'One or more real thinking acceptance probes failed; see sanitized results')
} finally {
  await settleNaming?.()
  close?.()
  Bun.gc(true)
  const checked = await realpath(directory)
  const segment = relative(root, checked)
  assert(segment && segment !== '..' && !segment.startsWith(`..${sep}`) && resolve(root, segment) === checked)
  await rm(checked, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 })
  console.log(`Sanitized evidence: ${artifacts}`)
}

/** Small opt-in live check of the real Mastra / SDK / transaction path, using a temporary database. */
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

assert(process.argv.includes('--real'), 'Use --real to authorize a small billable model request')
assert(process.env.AI_API_KEY, 'AI_API_KEY is required')
const root = await realpath(tmpdir())
const directory = await mkdtemp(join(root, 'shanhai-planning-'))
process.env.DATABASE_URL = `file:${join(directory, 'probe.db').replaceAll('\\', '/')}`
let close: (() => void) | undefined
try {
  await import('../server/database/migrate')
  const { db } = await import('../server/utils/db')
  const schema = await import('../server/database/schema')
  close = () => db.$client.close()
  const userId = crypto.randomUUID()
  db.insert(schema.user).values({ id: userId, email: `${userId}@example.invalid`, name: '验证用户', createdAt: new Date(), updatedAt: new Date() }).run()
  const { createPlan, getPlanSnapshot } = await import('../server/services/plan')
  const { createConversation, appendMessage } = await import('../server/services/conversation')
  const { createTravelMastra } = await import('../server/agents/travel-agent')
  const { configuredModel, validateModelConfiguration } = await import('../server/providers/models')
  const { handleChatStream } = await import('@mastra/ai-sdk')
  const { aiConfig } = await import('../server/utils/ai-config')
  const { extractActionable } = await import('../server/utils/errors')
  const created = await createPlan(userId, { title: '隔离杭州验证' })
  const conversation = await createConversation(userId, created.planId)
  const assistant = await appendMessage(conversation.id, { role: 'assistant' })
  const snapshot = await getPlanSnapshot(userId, created.planId)
  const configuration = validateModelConfiguration({ model: configuredModel(), webSearch: process.argv.includes('--search'), thinking: 'light' })
  const signal = AbortSignal.timeout(120_000)
  const mastra = createTravelMastra({ userId, planId: created.planId, conversationId: conversation.id, assistantMessageId: assistant.id, userName: '验证用户', plan: snapshot.plan, version: 1, revision: snapshot.row.revision, agentsMd: '', signal, configuration })
  const prompt = configuration.webSearch ? '请先联网查询杭州西湖旅行资料，然后直接保存杭州一天行程，包括西湖景点和东坡肉食记。' : process.argv.includes('--long') ? '请直接保存北京七天旅行行程，每天四个景点，并推荐七道美食和行前清单。无需追问。' : '请直接保存杭州两天旅行行程，每天两个景点，并推荐两道美食。无需追问。'
  let errors = 0
  let searchSources = 0
  let finishReason: string | undefined
  const stream = await handleChatStream({ mastra, agentId: 'travel-agent', version: 'v5', params: {
    messages: [{ id: 'probe', role: 'user', parts: [{ type: 'text', text: prompt }] }], maxSteps: 6, toolCallConcurrency: 1, abortSignal: signal,
    modelSettings: { maxOutputTokens: aiConfig().AI_OUTPUT_MAX_TOKENS, maxRetries: 0 },
    onStepFinish: step => { console.log(JSON.stringify({ step: true, finishReason: step.finishReason, usage: step.usage })) },
  } })
  for await (const chunk of stream) {
    if (chunk.type === 'tool-input-available') console.log(JSON.stringify({ tool: chunk.toolName, inputKeys: Object.keys(chunk.input as object), inputBytes: JSON.stringify(chunk.input).length }))
    if (chunk.type === 'tool-output-available') {
      const output = chunk.output as { ok?: boolean; error?: boolean; sources?: unknown[] }
      searchSources += output.sources?.length ?? 0
      console.log(JSON.stringify({ toolOutput: true, ok: output.ok, validationFailed: output.error === true, sources: output.sources?.length }))
    }
    if (chunk.type === 'finish') finishReason = chunk.finishReason
    if (chunk.type === 'error' || chunk.type === 'tool-output-error') { errors++; console.log(JSON.stringify({ error: chunk.type, detail: extractActionable(chunk.errorText) })) }
  }
  const current = await getPlanSnapshot(userId, created.planId)
  const result = { model: configuration.model, configuration, days: current.plan.days.length, spots: current.plan.days.reduce((n, day) => n + day.spots.length, 0), foods: current.plan.foodJournal.length, version: current.current?.version, errors, searchSources, finishReason }
  console.log(JSON.stringify(result))
  assert(result.days > 0 && result.spots > 0 && result.foods > 0 && result.version === 2, 'Planning must commit one valid version containing days, spots and food')
  assert(finishReason === 'stop', 'Model must finish without truncation or step exhaustion')
  if (configuration.webSearch) assert(searchSources > 0, 'Search must return actual tool sources')
} finally {
  close?.()
  Bun.gc(true)
  const checked = await realpath(directory)
  assert(resolve(checked).startsWith(root + sep))
  await rm(checked, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 })
}

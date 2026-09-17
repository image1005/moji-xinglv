import { handleChatStream } from '@mastra/ai-sdk'
import { createUIMessageStreamResponse } from 'ai'
import { and, eq } from 'drizzle-orm'
import { createError, readValidatedBody, setResponseHeader } from 'h3'
import { ChatBodySchema, extractUserText, trustedHistory } from '../../shared/schemas/chat'
import { PlanMutationResultSchema } from '../../shared/schemas/preview'
import { buildInstructions, createTravelMastra } from '../agents/travel-agent'
import { ALL_TOOLS, MUTATION_TOOLS } from '../agents/tool-names'
import { toolInputError } from '../agents/tool-inputs'
import { messages, planVersions } from '../database/schema'
import { resolveAgentsMd } from '../services/agents-md'
import { appendMessage, getConversation, listMessages, touchConversation } from '../services/conversation'
import { getPlanSnapshot } from '../services/plan'
import { attachRunMessage, checkpointRun, claimRun, finishRun, waitForRun } from '../services/chat-runs'
import { jsonBytes } from '../services/ai-context'
import { includeInitialRequirements } from '../services/ai-history'
import { recordMetric } from '../services/metrics'
import { aiConfig } from '../utils/ai-config'
import { db } from '../utils/db'
import { extractActionable, preserveActionableError } from '../utils/errors'
import { requireUser } from '../utils/session'

const FAILURE = '本次生成未完成，请检查 AI 服务配置后重试。已经保存的行程版本会保留。'
const TOOL_FAILURE = '工具执行失败，请重新读取当前规划后重试'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, ChatBodySchema.parse)
  const { conversationId, planId } = body
  const conversation = await getConversation(user.id, conversationId)
  if (conversation.planId !== planId) throw createError({ statusCode: 400, statusMessage: '会话与规划不匹配' })
  if (!process.env.AI_API_KEY) throw createError({ statusCode: 501, statusMessage: 'AI 尚未配置；您仍可手动编辑行程、地图与食记' })
  const textInput = extractUserText(body.messages.at(-1)!)
  const config = aiConfig()
  let task: ReturnType<typeof claimRun>
  try { task = claimRun(user.id, body.requestId ?? crypto.randomUUID(), planId, conversationId, textInput) }
  catch (error) {
    const retryAfter = (error as { data?: { retryAfter?: number } }).data?.retryAfter
    if (retryAfter) setResponseHeader(event, 'Retry-After', retryAfter)
    throw error
  }
  const run = new AbortController()
  let clientCancelled = false
  const onDisconnect = () => { clientCancelled = true; run.abort() }
  event.node?.res?.once('close', onDisconnect)
  const deadline = setTimeout(() => run.abort(), 180000)
  let assistantId: number | undefined
  let checkpointTimer: ReturnType<typeof setInterval> | undefined
  let usage: { inputTokens?: number; outputTokens?: number } = {}
  let steps = 0
  let metricRecorded = false
  let stepStartedAt = Date.now()
  let stepInFlight = false
  const recordUsage = (outcome: 'success' | 'error') => {
    if (metricRecorded) return
    metricRecorded = true
    if (stepInFlight) recordMetric({ service: 'ai', userId: user.id, outcome, durationMs: Date.now() - stepStartedAt, ...usage })
  }
  try {
    await waitForRun(task.id, run.signal)
    const { plan, current, row } = await getPlanSnapshot(user.id, planId)
    const history = includeInitialRequirements(user.id, conversationId, await listMessages(conversationId, 60))
    const agentsMd = await resolveAgentsMd(user.id, planId, { nickname: user.name || user.email, currency: plan.budget.currency })
    const agentContext = { userId: user.id, planId, conversationId, assistantMessageId: 0, userName: user.name, plan, version: current?.version ?? 1, revision: row.revision, agentsMd, signal: run.signal }
    let modelMessages: ReturnType<typeof trustedHistory>
    try { modelMessages = trustedHistory(history, textInput, config.AI_INPUT_MAX_BYTES - jsonBytes(buildInstructions(agentContext)) - Math.min(36000, config.AI_INPUT_MAX_BYTES / 3)) }
    catch { throw createError({ statusCode: 400, statusMessage: '本轮内容超过 AI 输入预算，请缩短消息或旅行偏好后重试' }) }
    const lastStored = history.at(-1)
    if (!(lastStored?.role === 'user' && lastStored.content === textInput)) await appendMessage(conversationId, { role: 'user', content: textInput })
    if (!history.some((m) => m.role === 'user')) await touchConversation(conversationId, textInput.slice(0, 28))
    const assistantRow = await appendMessage(conversationId, { role: 'assistant', content: '' })
    assistantId = assistantRow.id
    attachRunMessage(task.id, assistantId)
    const mastra = createTravelMastra({ ...agentContext, assistantMessageId: assistantId, onToolComplete: () => checkpointRun(task.id), onModelRequest: () => { stepStartedAt = Date.now(); stepInFlight = true } })
    run.signal.throwIfAborted()
    const initialize = () => handleChatStream({
      mastra, agentId: 'travel-agent', version: 'v5', onError: (error) => preserveActionableError(error) ?? FAILURE,
      params: {
        messages: modelMessages, maxSteps: 12, abortSignal: run.signal, toolCallConcurrency: 1,
        modelSettings: { maxOutputTokens: config.AI_OUTPUT_MAX_TOKENS, maxRetries: 0 },
        onFinish: result => { usage = { inputTokens: result.totalUsage.inputTokens, outputTokens: result.totalUsage.outputTokens } },
        onStepFinish: result => {
          steps++; stepInFlight = false
          recordMetric({ service: 'ai', userId: user.id, outcome: 'success', steps: 1, durationMs: Date.now() - stepStartedAt, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens })
          checkpointRun(task.id, steps)
        },
      },
    })
    const upstream = await new Promise<Awaited<ReturnType<typeof initialize>>>((resolve, reject) => {
      const aborted = () => reject(new Error(FAILURE))
      run.signal.addEventListener('abort', aborted, { once: true })
      void initialize().then((stream) => {
        run.signal.removeEventListener('abort', aborted)
        if (run.signal.aborted) { void stream.cancel().catch(() => {}); reject(new Error(FAILURE)) }
        else resolve(stream)
      }, (error: unknown) => {
        run.signal.removeEventListener('abort', aborted)
        reject(error)
      })
    })
    const reader = upstream.getReader()
    let text = ''
    const toolCalls: Record<string, unknown>[] = []
    let finalization: Promise<void> | undefined
    let failed = false
    let failureMessage = FAILURE
    let cancelled = false
    let onAbort: (() => void) | undefined
    let readerCancellation: Promise<void> | undefined
    const cancelReader = () => { readerCancellation ??= reader.cancel().catch(() => {}) }
    const checkpoint = async () => {
      // Durable tool commits may already have a preview that has not reached this stream yet.
      await db.update(messages).set({ content: text, toolCalls: toolCalls.length ? toolCalls : null }).where(eq(messages.id, assistantRow.id))
      checkpointRun(task.id, steps)
    }
    checkpointTimer = setInterval(() => { if (!finalization) void checkpoint().catch(() => run.abort()) }, 2000)
    const finalize = () => {
      finalization ??= (async () => {
        clearTimeout(deadline)
        clearInterval(checkpointTimer)
        event.node?.res?.off('close', onDisconnect)
        if (onAbort) run.signal.removeEventListener('abort', onAbort)
        try {
          await db.update(messages).set({
            content: text + (cancelled ? '\n\n[生成已停止]' : failed ? `\n\n${failureMessage}` : !text && !toolCalls.length ? '本次未返回文字，请重试。' : ''),
            toolCalls: toolCalls.length ? toolCalls : null,
          }).where(eq(messages.id, assistantRow.id))
          finishRun(task.id, cancelled ? 'cancelled' : failed ? 'failed' : 'completed', failed ? 'generation_failed' : undefined)
          recordUsage(failed || cancelled ? 'error' : 'success')
        } catch (error) { finishRun(task.id, 'failed', 'checkpoint_failed'); throw error }
      })()
      return finalization
    }
    const wrapped = new ReadableStream({
      start(controller) {
        onAbort = () => {
          cancelled ||= clientCancelled
          if (!cancelled) failed = true
          // 不等待不合作的上游 cancel 才落库/解锁；工具入口同步检查 AbortSignal。
          cancelReader()
          void finalize().catch(() => {})
          try { controller.close() } catch { /* 客户端可能已关闭 */ }
        }
        run.signal.addEventListener('abort', onAbort, { once: true })
        if (run.signal.aborted) onAbort()
      },
      async pull(controller) {
        try {
          while (true) {
          const { value, done } = await reader.read()
          if (finalization) return
          if (done) { await finalize(); controller.close(); return }
          const part = value as unknown as Record<string, unknown>
          if (part.type === 'text-delta' && typeof part.delta === 'string') {
            text += part.delta
            if (text.length > 100000) { failed = true; run.abort(); return }
          }
          if (part.type === 'tool-input-available') {
            if (typeof part.toolCallId !== 'string' || typeof part.toolName !== 'string' || !ALL_TOOLS.has(part.toolName) || toolCalls.some((item) => item.id === part.toolCallId)) continue
            toolCalls.push({ id: part.toolCallId, name: part.toolName, input: part.input })
          }
          if (part.type === 'tool-output-available') {
            const call = toolCalls.find((item) => item.id === part.toolCallId)
            if (!call) continue
            // Mastra 的入参校验失败可能作为普通 tool-result 返回，读取工具也需要校验。
            const inputError = toolInputError(call.name, call.input)
            if (inputError) {
              call.error = inputError
              controller.enqueue({ type: 'tool-output-error', toolCallId: part.toolCallId as string, errorText: inputError })
              return
            }
            const result = part.output as { error?: unknown; validationErrors?: unknown } | null
            if (result?.error === true && result.validationErrors) {
              const errorText = '工具返回结果校验失败，请稍后重试或联系管理员检查工具实现。'
              call.error = errorText
              controller.enqueue({ type: 'tool-output-error', toolCallId: part.toolCallId as string, errorText })
              return
            }
            if (typeof call.name === 'string' && MUTATION_TOOLS.has(call.name)) {
              const parsed = PlanMutationResultSchema.safeParse(part.output)
              const output = parsed.success ? parsed.data : null
              const version = output?.versionId ? await db.select({ id: planVersions.id }).from(planVersions).where(and(
                eq(planVersions.id, output.versionId), eq(planVersions.planId, planId), eq(planVersions.version, output.version),
              )).get() : null
              if (!output || output.preview.planId !== planId || output.preview.version !== output.version || !version) {
                call.error = TOOL_FAILURE
                controller.enqueue({ type: 'tool-output-error', toolCallId: part.toolCallId as string, errorText: TOOL_FAILURE })
                return
              }
              call.output = output
              await checkpoint()
              controller.enqueue({ ...value, output })
              return
            }
            call.output = part.output
            await checkpoint()
          }
          if (part.type === 'tool-output-error') {
            const call = toolCalls.find((item) => item.id === part.toolCallId)
            if (!call) continue
            // 我们自己的校验 / 冲突类错误带可操作提示，脱敏后透传；未知错误统一替换。
            const text = toolInputError(call.name, call.input) ?? extractActionable(part.errorText) ?? TOOL_FAILURE
            call.error = text
            controller.enqueue({ type: 'tool-output-error', toolCallId: part.toolCallId as string, errorText: text })
            return
          }
          if (part.type === 'error') {
            failed = true
            failureMessage = extractActionable(part.errorText) ?? FAILURE
            controller.enqueue({ ...value, errorText: failureMessage })
          } else controller.enqueue(value)
          return
          }
        } catch {
          failed = true
          run.abort()
          await finalize().catch(() => {})
          try { controller.error(new Error(FAILURE)) } catch { /* 已关闭 */ }
        }
      },
      async cancel() {
        cancelled = true
        run.abort()
        cancelReader()
        await finalize()
      },
    })
    return createUIMessageStreamResponse({ stream: wrapped })
  } catch (error) {
    run.abort()
    clearTimeout(deadline)
    clearInterval(checkpointTimer)
    event.node?.res?.off('close', onDisconnect)
    finishRun(task.id, clientCancelled ? 'cancelled' : 'failed', clientCancelled ? undefined : 'initialization_failed')
    recordUsage('error')
    if (assistantId) await db.update(messages).set({ content: clientCancelled ? '[生成已停止]' : FAILURE }).where(eq(messages.id, assistantId))
    const status = (error as { statusCode?: number }).statusCode
    if (status && status < 500) {
      const retryAfter = (error as { data?: { retryAfter?: number } }).data?.retryAfter
      if (retryAfter) setResponseHeader(event, 'Retry-After', retryAfter)
      throw error
    }
    throw createError({ statusCode: 502, statusMessage: 'AI 服务暂不可用，请检查服务端配置后重试' })
  }
})

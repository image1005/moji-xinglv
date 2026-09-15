import { handleChatStream } from '@mastra/ai-sdk'
import { createUIMessageStreamResponse } from 'ai'
import { and, eq } from 'drizzle-orm'
import { createError, readValidatedBody } from 'h3'
import { ChatBodySchema, extractUserText, trustedHistory } from '../../shared/schemas/chat'
import { PlanMutationResultSchema } from '../../shared/schemas/preview'
import type { PlanPreview } from '../../shared/types'
import { createTravelMastra } from '../agents/travel-agent'
import { ALL_TOOLS, MUTATION_TOOLS } from '../agents/tool-names'
import { messages, planVersions } from '../database/schema'
import { resolveAgentsMd } from '../services/agents-md'
import { appendMessage, getConversation, listMessages, touchConversation } from '../services/conversation'
import { getPlanSnapshot } from '../services/plan'
import { db } from '../utils/db'
import { extractActionable } from '../utils/errors'
import { requireUser } from '../utils/session'

/** 进程内每规划单流；数据库 CAS 另外防止多实例/人工编辑导致的陈旧写入。 */
const activePlans = new Set<number>()
const FAILURE = '本次生成未完成，请检查 AI 服务配置后重试。已经保存的行程版本会保留。'
const TOOL_FAILURE = '工具执行失败，请重新读取当前规划后重试'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, ChatBodySchema.parse)
  const { conversationId, planId } = body
  const conversation = await getConversation(user.id, conversationId)
  if (conversation.planId !== planId) throw createError({ statusCode: 400, statusMessage: '会话与规划不匹配' })
  if (!process.env.AI_API_KEY) throw createError({ statusCode: 501, statusMessage: 'AI 尚未配置；您仍可手动编辑行程、地图与食记' })
  if (activePlans.has(planId)) throw createError({ statusCode: 409, statusMessage: '该规划正在生成，请等待完成后再发送' })
  activePlans.add(planId)
  const run = new AbortController()
  const deadline = setTimeout(() => run.abort(), 180000)
  let assistantId: number | undefined
  try {
    const { plan, current } = await getPlanSnapshot(user.id, planId)
    const history = await listMessages(conversationId)
    const textInput = extractUserText(body.messages.at(-1)!)
    const modelMessages = trustedHistory(history, textInput)
    const agentsMd = await resolveAgentsMd(user.id, planId, { nickname: user.name || user.email, currency: plan.budget.currency })
    const lastStored = history.at(-1)
    if (!(lastStored?.role === 'user' && lastStored.content === textInput)) await appendMessage(conversationId, { role: 'user', content: textInput })
    if (!history.some((m) => m.role === 'user')) await touchConversation(conversationId, textInput.slice(0, 28))
    const assistantRow = await appendMessage(conversationId, { role: 'assistant', content: '' })
    assistantId = assistantRow.id
    const mastra = createTravelMastra({ userId: user.id, planId, conversationId, assistantMessageId: assistantId, userName: user.name, plan, version: current?.version ?? 1, agentsMd, signal: run.signal })
    run.signal.throwIfAborted()
    const initialize = () => handleChatStream({
      mastra, agentId: 'travel-agent', version: 'v5', onError: () => FAILURE,
      params: { messages: modelMessages, maxSteps: 12, abortSignal: run.signal },
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
    let preview: PlanPreview | null = null
    let planVersionId: number | null = null
    let finalization: Promise<void> | undefined
    let failed = false
    let cancelled = false
    let onAbort: (() => void) | undefined
    let readerCancellation: Promise<void> | undefined
    const cancelReader = () => { readerCancellation ??= reader.cancel().catch(() => {}) }
    const finalize = () => {
      finalization ??= (async () => {
        clearTimeout(deadline)
        if (onAbort) run.signal.removeEventListener('abort', onAbort)
        try {
          await db.update(messages).set({
            content: text + (cancelled ? '\n\n[生成已停止]' : failed ? `\n\n${FAILURE}` : !text && !toolCalls.length ? '本次未返回文字，请重试。' : ''),
            toolCalls: toolCalls.length ? toolCalls : null, previewJson: preview, planVersionId,
          }).where(eq(messages.id, assistantRow.id))
        } finally { activePlans.delete(planId) }
      })()
      return finalization
    }
    const wrapped = new ReadableStream({
      start(controller) {
        onAbort = () => {
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
              preview = output.preview
              planVersionId = output.versionId
              call.output = output
              controller.enqueue({ ...value, output })
              return
            }
            call.output = part.output
          }
          if (part.type === 'tool-output-error') {
            const call = toolCalls.find((item) => item.id === part.toolCallId)
            if (!call) continue
            // 我们自己的校验 / 冲突类错误带可操作提示，脱敏后透传；未知错误统一替换。
            const text = extractActionable(part.errorText) ?? TOOL_FAILURE
            call.error = text
            controller.enqueue({ ...value, errorText: text })
            return
          }
          if (part.type === 'error') {
            failed = true
            controller.enqueue({ ...value, errorText: FAILURE })
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
  } catch {
    run.abort()
    clearTimeout(deadline)
    activePlans.delete(planId)
    if (assistantId) await db.update(messages).set({ content: FAILURE }).where(eq(messages.id, assistantId))
    throw createError({ statusCode: 502, statusMessage: 'AI 服务暂不可用，请检查服务端配置后重试' })
  }
})

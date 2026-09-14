import { handleChatStream } from '@mastra/ai-sdk'
import { createUIMessageStreamResponse, type UIMessage } from 'ai'
import { eq } from 'drizzle-orm'
import { createError, readBody } from 'h3'
import { z } from 'zod'
import type { PlanPreview } from '../../shared/types'
import { createTravelMastra } from '../agents/travel-agent'
import { messages } from '../database/schema'
import { resolveAgentsMd } from '../services/agents-md'
import { appendMessage, getConversation, listMessages, touchConversation } from '../services/conversation'
import { getLatestVersion, getPlanRow, parsePlanJson } from '../services/plan'
import { db } from '../utils/db'
import { requireUser } from '../utils/session'

/** 流式聊天入口：Mastra + AI SDK v5 协议（PRD §3.2 / 硬约束 6/7） */

const ChatBodySchema = z.object({
  messages: z.array(z.unknown()).min(1),
  conversationId: z.coerce.number().int().positive(),
  planId: z.coerce.number().int().positive(),
})

function extractText(message: UIMessage | undefined): string {
  if (!message) return ''
  return (message.parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
    .trim()
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const parsed = ChatBodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '请求体不合法：需要 messages / conversationId / planId' })
  }
  const { conversationId, planId } = parsed.data
  const uiMessages = parsed.data.messages as UIMessage[]

  const conversation = await getConversation(user.id, conversationId)
  if (conversation.planId !== planId) {
    throw createError({ statusCode: 400, statusMessage: '会话与规划不匹配' })
  }
  const planRow = await getPlanRow(user.id, planId)
  const plan = parsePlanJson(planRow.planJson)
  const latest = await getLatestVersion(planId)

  // 持久化最新一条用户消息（历史由 buildInstructions 中的 plan 快照与消息列表提供）
  const history = await listMessages(conversationId)
  const lastUser = [...uiMessages].reverse().find((m) => m.role === 'user')
  const userText = extractText(lastUser)
  const lastStored = history[history.length - 1]
  if (userText && !(lastStored?.role === 'user' && lastStored.content === userText)) {
    await appendMessage(conversationId, { role: 'user', content: userText })
    if (history.filter((m) => m.role === 'user').length === 0) {
      await touchConversation(conversationId, userText.slice(0, 20))
    }
  }

  // 预创建 assistant 消息行：工具用它的 id 关联 plan_versions.message_id
  const assistantRow = await appendMessage(conversationId, { role: 'assistant', content: '' })

  const agentsMd = await resolveAgentsMd(user.id, planId, { nickname: user.name || user.email, currency: 'CNY' })
  const mastra = createTravelMastra({
    userId: user.id,
    planId,
    conversationId,
    assistantMessageId: assistantRow.id,
    userName: user.name,
    plan,
    version: latest?.version ?? 1,
    agentsMd,
  })

  const stream = await handleChatStream({
    mastra,
    agentId: 'travel-agent',
    params: { messages: uiMessages },
  })

  let text = ''
  const toolCalls: Record<string, unknown>[] = []
  let preview: PlanPreview | null = null
  let planVersionId: number | null = null

  const observer = new TransformStream<unknown, unknown>({
    transform(chunk, controller) {
      if (chunk && typeof chunk === 'object') {
        const part = chunk as Record<string, unknown>
        const type = part.type
        if (type === 'text-delta' && typeof part.delta === 'string') text += part.delta
        if (type === 'tool-input-available') {
          toolCalls.push({ id: part.toolCallId, name: part.toolName, input: part.input })
        }
        if (type === 'tool-output-available') {
          const call = toolCalls.find((c) => c.id === part.toolCallId)
          if (call) call.output = part.output
          const output = part.output as { preview?: PlanPreview; versionId?: number | null } | undefined
          if (output?.preview) preview = output.preview
          if (output?.versionId) planVersionId = output.versionId
        }
        if (type === 'tool-output-error') {
          const call = toolCalls.find((c) => c.id === part.toolCallId)
          if (call) call.error = part.errorText
        }
      }
      controller.enqueue(chunk)
    },
    async flush() {
      try {
        await db
          .update(messages)
          .set({
            content: text,
            toolCalls: (toolCalls.length ? toolCalls : null) as never,
            previewJson: preview as never,
            planVersionId,
          })
          .where(eq(messages.id, assistantRow.id))
      } catch (error) {
        console.error('[chat] 保存 assistant 消息失败', error)
      }
    },
  })

  const wrapped = (stream as ReadableStream<unknown>).pipeThrough(observer) as unknown as typeof stream
  return createUIMessageStreamResponse({ stream: wrapped })
})

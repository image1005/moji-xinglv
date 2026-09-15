import { z } from 'zod'
import type { MessageRecord } from '../types'

const MessageSchema = z.object({
  id: z.string().max(160).optional(),
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(z.object({ type: z.string().max(100), text: z.string().max(20000).optional() }).passthrough()).max(300),
})
export const ChatBodySchema = z.object({
  messages: z.array(MessageSchema).min(1).max(250),
  conversationId: z.coerce.number().int().positive(),
  planId: z.coerce.number().int().positive(),
}).superRefine((body, ctx) => {
  const last = body.messages.at(-1)
  if (last?.role !== 'user' || !extractUserText(last).trim()) {
    ctx.addIssue({ code: 'custom', path: ['messages'], message: '最后一条必须是非空用户文字消息' })
  }
  if (last && extractUserText(last).length > 20000) ctx.addIssue({ code: 'custom', path: ['messages'], message: '消息超过长度限制' })
})

export function extractUserText(message: { parts: { type: string; text?: string }[] }) {
  return message.parts.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('').trim()
}

/** 客户端历史不进入模型：仅服务器已存文字 + 最新用户输入，避免伪造工具/系统消息。 */
export function trustedHistory(records: MessageRecord[], latestText: string) {
  const result = records.filter((record) => record.content && (record.role === 'user' || record.role === 'assistant'))
    .slice(-60).map((record) => ({
      id: `db-${record.id}`, role: record.role as 'user' | 'assistant',
      parts: [{ type: 'text' as const, text: record.content.slice(0, 20000) }],
    }))
  const last = result.at(-1)
  if (!(last?.role === 'user' && last.parts[0]?.text === latestText)) {
    result.push({ id: 'current-user', role: 'user', parts: [{ type: 'text', text: latestText }] })
  }
  return result
}

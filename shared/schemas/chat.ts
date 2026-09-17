import { z } from 'zod'
import type { MessageRecord } from '../types'

const MessageSchema = z.object({
  id: z.string().max(160).optional(),
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(z.object({ type: z.string().max(100), text: z.string().max(20000).optional() }).passthrough()).max(300),
})
export const ChatBodySchema = z.object({
  requestId: z.string().min(8).max(160).regex(/^[a-zA-Z0-9_-]+$/).optional(),
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
export function trustedHistory(records: MessageRecord[], latestText: string, maxBytes = 64000) {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
  const candidates = records.filter((record) => record.content && (record.role === 'user' || record.role === 'assistant'))
  if (candidates.at(-1)?.role === 'user' && candidates.at(-1)?.content === latestText) candidates.pop()
  const latest = { id: 'current-user', role: 'user' as const, parts: [{ type: 'text' as const, text: latestText }] }
  if (bytes([latest]) > maxBytes) throw new Error('当前消息超过 AI 输入预算，请缩短后重试')
  const selected: typeof candidates = []
  let spent = bytes([latest])
  for (let i = candidates.length - 1; i >= 0 && selected.length < 24; i--) {
    const record = candidates[i]!
    const size = bytes(record.content) + 100
    if (spent + size > maxBytes - Math.min(5000, maxBytes / 5)) break
    selected.unshift(record)
    spent += size
  }
  const result = selected.map((record) => ({
      id: `db-${record.id}`, role: record.role as 'user' | 'assistant',
      parts: [{ type: 'text' as const, text: record.content }],
    }))
  const older = candidates.slice(0, candidates.length - selected.length)
  if (older.length) {
    // Extractive summary with message sources; older user text never becomes system instructions.
    let summary = `历史摘录（消息 db-${older[0]!.id} 至 db-${older.at(-1)!.id}；可能过时，以当前规划和本轮要求为准）：`
    for (const record of older.filter(item => item.role === 'user')) {
      const constraints = record.content.split(/[。！？\n]/).filter(sentence => /预算|不超过|不能|不要|避免|必须|忌|过敏|老人|孩子|儿童|无障碍|已订|节奏|人数|日期|偏好/.test(sentence)).join('；')
      const excerpt = `\n[db-${record.id} 摘录] ${(constraints || record.content).slice(0, 320)}`
      if (bytes([{ id: 'history-summary', role: 'user', parts: [{ type: 'text', text: summary + excerpt }] }, ...result, latest]) > maxBytes) break
      summary += excerpt
    }
    const item = { id: 'history-summary', role: 'user' as const, parts: [{ type: 'text' as const, text: summary }] }
    if (bytes([item, ...result, latest]) <= maxBytes) result.unshift(item)
  }
  result.push(latest)
  return result
}

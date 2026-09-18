import { z } from 'zod'
import { ModelConfigurationSchema } from './model-config'

const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/)
const ChatInputPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(20000) }).strict(),
  z.object({ type: z.literal('file'), attachmentId: z.string().min(1).max(100) }).strict(),
])
export const ChatRequestSchema = z.object({
  protocolVersion: z.literal(1), type: z.literal('message'), requestId: identifier, messageId: identifier,
  planId: z.number().int().positive(), conversationId: z.number().int().positive(),
  configuration: ModelConfigurationSchema.optional(),
  message: z.object({ id: identifier, role: z.literal('user'), parts: z.array(ChatInputPartSchema).min(1).max(8) }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.messageId !== value.message.id) ctx.addIssue({ code: 'custom', path: ['messageId'], message: '消息编号不一致' })
  const text = value.message.parts.filter(p => p.type === 'text').map(p => p.text).join('').trim()
  const files = value.message.parts.filter(p => p.type === 'file')
  if (text.length > 20000 || (!text && !files.length)) ctx.addIssue({ code: 'custom', path: ['message', 'parts'], message: '请发送文字或图片，文字最多 20000 字符' })
  if (files.length > 4 || new Set(files.map(p => p.attachmentId)).size !== files.length) ctx.addIssue({ code: 'custom', path: ['message', 'parts'], message: '最多四张不重复的图片' })
})
export type ChatRequest = z.infer<typeof ChatRequestSchema>

const envelope = { protocolVersion: z.literal(1), requestId: identifier, messageId: identifier, seq: z.number().int().nonnegative() }
/** SDK chunk payloads are validated by the installed SDK's own stream decoder. */
const ChatEventSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('chunk'), chunk: z.object({ type: z.string().min(1) }).passthrough() }).strict(),
  z.object({ ...envelope, type: z.literal('status'), status: z.enum(['queued', 'running', 'saving']) }).strict(),
  z.object({ ...envelope, type: z.literal('error'), code: z.string().max(100), message: z.string().max(1000) }).strict(),
  z.object({ ...envelope, type: z.literal('terminal'), status: z.enum(['completed', 'cancelled', 'failed']) }).strict(),
])
type ChatEvent = z.infer<typeof ChatEventSchema>

/** Only a small duplicate window is retained, never the complete response or message state. */
export class ChatEventSequence {
  private next = 0
  private messageId?: string
  private recent = new Map<number, string>()
  private ended = false
  constructor(private requestId: string) {}
  accept(input: unknown): ChatEvent | null {
    const event = ChatEventSchema.parse(input)
    if (event.requestId !== this.requestId || (this.messageId && this.messageId !== event.messageId)) throw new Error('聊天事件身份不匹配')
    const encoded = JSON.stringify(event)
    if (event.seq < this.next) {
      if (this.recent.get(event.seq) === encoded) return null
      throw new Error('聊天事件重复内容不一致或超出窗口')
    }
    if (this.ended || event.seq !== this.next) throw new Error('聊天事件顺序不完整')
    this.messageId = event.messageId
    this.recent.set(event.seq, encoded)
    this.recent.delete(event.seq - 64)
    this.next++
    this.ended = event.type === 'terminal'
    return event
  }
  finish() { if (!this.ended) throw new Error('连接中断，缺少生成终态；请恢复已保存结果') }
}

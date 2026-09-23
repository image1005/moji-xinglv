import type { MessageRecord } from '../types'
import type { FileUIPart, TextUIPart } from 'ai'

export function extractUserText(message: { parts: { type: string; text?: string }[] }) {
  return message.parts.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('').trim()
}

/** 客户端历史不进入模型：仅服务器已存文字 + 最新用户输入，避免伪造工具/系统消息。 */
type HistoryMessage = { id: string; role: 'user' | 'assistant'; parts: (TextUIPart | (FileUIPart & { attachmentId?: string }))[] }

export function trustedHistory(records: MessageRecord[], latestText: string, maxBytes = 64000, latestAttachments: string[] = []): HistoryMessage[] {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength
  const files = (record: MessageRecord) => record.parts?.flatMap(part => part.type === 'file' && typeof part.attachmentId === 'string' ? [{ type: 'file' as const, attachmentId: part.attachmentId, url: '', mediaType: typeof part.mediaType === 'string' ? part.mediaType : 'image/jpeg' }] : []) ?? []
  const candidates = records.filter((record) => (record.content || files(record).length) && (record.role === 'user' || record.role === 'assistant'))
  const last = candidates.at(-1)
  if (last?.role === 'user' && last.content === latestText && JSON.stringify(files(last).map(p => p.attachmentId)) === JSON.stringify(latestAttachments)) candidates.pop()
  const latest: HistoryMessage = { id: 'current-user', role: 'user', parts: [...(latestText ? [{ type: 'text' as const, text: latestText }] : []), ...latestAttachments.map(attachmentId => ({ type: 'file' as const, attachmentId, url: '', mediaType: 'image/jpeg' }))] }
  if (bytes([latest]) > maxBytes) throw new Error('当前消息超过 AI 输入预算，请缩短后重试')
  const selected: typeof candidates = []
  let spent = bytes([latest])
  for (let i = candidates.length - 1; i >= 0 && selected.length < 24; i--) {
    const record = candidates[i]!
    const size = bytes(record.content) + bytes(files(record)) + 100
    if (spent + size > maxBytes - Math.min(5000, maxBytes / 5)) break
    selected.unshift(record)
    spent += size
  }
  const result: HistoryMessage[] = selected.map((record) => ({
      id: `db-${record.id}`, role: record.role as 'user' | 'assistant',
      parts: [...(record.content ? [{ type: 'text' as const, text: record.content }] : []), ...files(record)],
    }))
  const older = candidates.slice(0, candidates.length - selected.length)
  if (older.length) {
    // Images are persisted requirements too. Keep authorized references even when their text is summarized.
    // The application enforces a separate image count/byte budget before resolving their bytes.
    const illustrated: HistoryMessage[] = older.filter(record => record.role === 'user' && files(record).length).map(record => ({
      id: `db-${record.id}`, role: 'user', parts: [...(record.content ? [{ type: 'text' as const, text: record.content.slice(0, 320) }] : []), ...files(record)],
    }))
    if (bytes([...illustrated, ...result, latest]) > maxBytes) throw new Error('历史图片引用超过 AI 输入预算，请新建会话选择所需图片')
    result.unshift(...illustrated)
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

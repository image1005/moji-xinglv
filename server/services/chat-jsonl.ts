import { createError, getHeader, getRequestWebStream, type H3Event } from 'h3'
import type { UIMessageChunk } from 'ai'
import { ChatRequestSchema } from '../../shared/schemas/chat-protocol'
import { encodeJsonLine, readJsonLines } from '../../shared/utils/jsonl'

export async function readChatRequest(event: H3Event) {
  if (getHeader(event, 'content-type')?.split(';')[0]?.trim() !== 'application/x-ndjson') throw createError({ statusCode: 415, statusMessage: '聊天请求必须使用 application/x-ndjson' })
  const length = Number(getHeader(event, 'content-length') ?? 0)
  if (length > 128 * 1024) throw createError({ statusCode: 413, statusMessage: '聊天请求过大，请通过附件接口上传图片' })
  const stream = getRequestWebStream(event) as ReadableStream<Uint8Array> | undefined
  if (!stream) throw createError({ statusCode: 400, statusMessage: '缺少聊天消息' })
  try {
    const records: unknown[] = []
    for await (const record of readJsonLines(stream, { maxBytes: 128 * 1024, maxRecords: 1, timeoutMs: 15000 })) records.push(record)
    if (records.length !== 1) throw new Error('每次发送需要一条用户消息记录')
    return ChatRequestSchema.parse(records[0])
  } catch { throw createError({ statusCode: 400, statusMessage: 'JSONL 消息格式错误、超出限制或读取超时' }) }
}

export function jsonlChatResponse(stream: ReadableStream<UIMessageChunk>, identity: { requestId: string; messageId: string }, getStatus: () => 'completed' | 'cancelled' | 'failed') {
  const reader = stream.getReader()
  let seq = 0, started = false
  const event = (value: object) => {
    const bytes = encodeJsonLine({ protocolVersion: 1, ...identity, seq, ...value })
    if (bytes.byteLength > 128 * 1024) throw new Error('聊天事件过大')
    seq++
    return bytes
  }
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) { started = true; controller.enqueue(event({ type: 'status', status: 'running' })); return }
        const next = await reader.read()
        if (next.done) { controller.enqueue(event({ type: 'terminal', status: getStatus() })); controller.close(); reader.releaseLock(); return }
        controller.enqueue(event({ type: 'chunk', chunk: next.value }))
      } catch {
        controller.enqueue(event({ type: 'error', code: 'stream_failed', message: '生成连接中断，已保存的内容可以恢复' }))
        controller.enqueue(event({ type: 'terminal', status: 'failed' }))
        controller.close()
        void reader.cancel().catch(() => {})
      }
    },
    async cancel(reason) { await reader.cancel(reason) },
  }), { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' } })
}

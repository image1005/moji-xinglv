import { DefaultChatTransport, type HttpChatTransportInitOptions, type UIMessage } from 'ai'
import { ChatEventSequence, ChatRequestSchema } from '#shared/schemas/chat-protocol'
import { readJsonLines } from '#shared/utils/jsonl'

/** Thin transport: the SDK owns messages, tool parts and streaming state. */
export class JsonlChatTransport<M extends UIMessage> extends DefaultChatTransport<M> {
  constructor(options: HttpChatTransportInitOptions<M> = {}) {
    const requestFetch = options.fetch ?? globalThis.fetch
    super({ ...options, fetch: (async (input, init) => {
      if (init?.method !== 'POST' || typeof init.body !== 'string') throw new Error('聊天仅支持新消息请求，历史从数据库恢复')
      const body = JSON.parse(init.body) as { requestId: string; planId: number; conversationId: number; configuration?: unknown; messages: M[] }
      const latest = body.messages.at(-1)
      if (!latest) throw new Error('缺少消息')
      const parts = latest.parts.filter(p => p.type === 'text' || p.type === 'file').map(part => {
        if (part.type === 'text') return { type: 'text', text: part.text }
        const file = part as { attachmentId?: string; url?: string }
        const id = file.attachmentId ?? /^\/api\/attachments\/([a-zA-Z0-9_-]+)$/.exec(file.url ?? '')?.[1]
        return { type: 'file', attachmentId: id }
      })
      const request = ChatRequestSchema.parse({ protocolVersion: 1, type: 'message', requestId: body.requestId,
        messageId: latest.id, planId: body.planId, conversationId: body.conversationId, configuration: body.configuration,
        message: { id: latest.id, role: 'user', parts } })
      const headers = new Headers(init.headers)
      headers.set('content-type', 'application/x-ndjson')
      headers.set('accept', 'application/x-ndjson')
      const response = await requestFetch(input, { ...init, headers, body: `${JSON.stringify(request)}\n` })
      if (!response.ok) return response
      if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/x-ndjson' || !response.body) {
        // A rejected stream may still be generating remotely; do not leave it running.
        void response.body?.cancel().catch(() => {})
        throw new Error('服务端返回的聊天协议不受支持')
      }
      const cancelled = new AbortController()
      const records = readJsonLines(response.body, { signal: init.signal ? AbortSignal.any([init.signal, cancelled.signal]) : cancelled.signal })
      const sequence = new ChatEventSequence(request.requestId)
      const encoder = new TextEncoder()
      let receivedError = false
      const sdkStream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            while (true) {
              const next = await records.next()
              if (next.done) { sequence.finish(); controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); return }
              const event = sequence.accept(next.value)
              if (!event) continue
              let chunk: unknown
              if (event.type === 'chunk') { chunk = event.chunk; receivedError ||= event.chunk.type === 'error' }
              else if (event.type === 'error') { receivedError = true; chunk = { type: 'error', errorText: event.message } }
              else if (event.type === 'status') chunk = { type: 'data-status', data: { status: event.status }, transient: true }
              else if (event.status !== 'completed' && !receivedError) chunk = { type: 'error', errorText: event.status === 'cancelled' ? '生成已停止，已保存内容可以恢复' : '生成未完成，已保存内容可以恢复' }
              if (chunk) { controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)); return }
            }
          } catch (error) { await records.return(undefined); controller.error(error) }
        },
        async cancel() { cancelled.abort(); await records.return(undefined) },
      })
      // Reuse DefaultChatTransport's SDK-v5 chunk validation and assembly.
      return new Response(sdkStream, { status: response.status, headers: { 'content-type': 'text/event-stream' } })
    }) as NonNullable<HttpChatTransportInitOptions<M>['fetch']> })
  }
}

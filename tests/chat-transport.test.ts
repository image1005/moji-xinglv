import { describe, expect, it, vi } from 'vitest'
import type { UIMessage, UIMessageChunk } from 'ai'
import { JsonlChatTransport } from '../app/utils/chat-transport'
import { encodeJsonLine } from '../shared/utils/jsonl'

const input: UIMessage[] = [{ id: 'input-1', role: 'user', parts: [{ type: 'file', url: '/api/attachments/photo-1', mediaType: 'image/png' }] }]
const envelope = (seq: number, value: object) => ({ protocolVersion: 1, requestId: 'request-1', messageId: 'db-1', seq, ...value })
async function chunks(stream: ReadableStream<UIMessageChunk>) {
  const result = [], reader = stream.getReader()
  while (true) { const next = await reader.read(); if (next.done) return result; result.push(next.value) }
}
function transport(records: object[], onRequest?: (init: RequestInit) => void) {
  return new JsonlChatTransport({
    body: { requestId: 'request-1', planId: 1, conversationId: 1 },
    fetch: async (_url, init) => {
      onRequest?.(init!)
      return new Response(new ReadableStream({ start(controller) { for (const record of records) controller.enqueue(encodeJsonLine(record)); controller.close() } }), { headers: { 'content-type': 'application/x-ndjson' } })
    },
  })
}
const send = (value: JsonlChatTransport<UIMessage>) => value.sendMessages({ trigger: 'submit-message', chatId: 'conversation-1', messageId: undefined, messages: input, abortSignal: undefined })

describe('JSONL adapter with the real AI SDK v5 decoder', () => {
  it('sends references only, exposes incremental parts, deduplicates events and validates SDK chunks', async () => {
    const first = envelope(0, { type: 'chunk', chunk: { type: 'text-start', id: 'text-1' } })
    const received = await chunks(await send(transport([
      first, first, envelope(1, { type: 'chunk', chunk: { type: 'text-delta', id: 'text-1', delta: '山海行笺' } }),
      envelope(2, { type: 'chunk', chunk: { type: 'text-end', id: 'text-1' } }),
      envelope(3, { type: 'chunk', chunk: { type: 'finish' } }), envelope(4, { type: 'terminal', status: 'completed' }),
    ], init => {
      expect(new Headers(init.headers).get('content-type')).toBe('application/x-ndjson')
      const body = JSON.parse(String(init.body))
      expect(body.message.parts).toEqual([{ type: 'file', attachmentId: 'photo-1' }])
      expect(String(init.body)).not.toContain('base64')
      expect(String(init.body)).toMatch(/\n$/)
    })))
    expect(received).toHaveLength(4)
    expect(received[1]).toMatchObject({ type: 'text-delta', delta: '山海行笺' })
  })
  it('rejects truncated streams and malformed SDK payloads instead of reporting success', async () => {
    await expect(chunks(await send(transport([envelope(0, { type: 'status', status: 'running' })])))).rejects.toThrow('终态')
    await expect(chunks(await send(transport([
      envelope(0, { type: 'chunk', chunk: { type: 'text-delta', delta: 2 } }), envelope(1, { type: 'terminal', status: 'completed' }),
    ])))).rejects.toThrow()
  })

  it('delivers the first partial response before the HTTP response closes', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>
    const value = new JsonlChatTransport({
      body: { requestId: 'request-1', planId: 1, conversationId: 1 },
      fetch: async () => new Response(new ReadableStream({ start(controller) { source = controller } }), { headers: { 'content-type': 'application/x-ndjson' } }),
    })
    const reader = (await send(value)).getReader()
    source.enqueue(encodeJsonLine(envelope(0, { type: 'chunk', chunk: { type: 'text-start', id: 't' } })))
    source.enqueue(encodeJsonLine(envelope(1, { type: 'chunk', chunk: { type: 'text-delta', id: 't', delta: '西湖' } })))
    expect((await reader.read()).value).toMatchObject({ type: 'text-start' })
    expect((await reader.read()).value).toMatchObject({ type: 'text-delta', delta: '西湖' })
    source.enqueue(encodeJsonLine(envelope(2, { type: 'terminal', status: 'completed' })))
    source.close()
    expect((await reader.read()).done).toBe(true)
    reader.releaseLock()
  })

  it('cancels a pending HTTP read without waiting for an uncooperative source cancel hook', async () => {
    let sourceCancelled = false
    const value = new JsonlChatTransport({
      body: { requestId: 'request-1', planId: 1, conversationId: 1 },
      fetch: async () => new Response(new ReadableStream({ cancel() { sourceCancelled = true; return new Promise<void>(() => {}) } }), { headers: { 'content-type': 'application/x-ndjson' } }),
    })
    const reader = (await send(value)).getReader()
    const waiting = reader.read()
    await reader.cancel('user stopped')
    expect((await waiting).done).toBe(true)
    await vi.waitFor(() => expect(sourceCancelled).toBe(true), { timeout: 200 })
    reader.releaseLock()
  })

  it('rejects a different response identity and events after the terminal', async () => {
    await expect(chunks(await send(transport([envelope(0, { requestId: 'other-request', type: 'terminal', status: 'completed' })])))).rejects.toThrow('身份')
    await expect(chunks(await send(transport([
      envelope(0, { type: 'terminal', status: 'completed' }), envelope(1, { type: 'chunk', chunk: { type: 'finish' } }),
    ])))).rejects.toThrow('顺序')
  })

  it('does not report successful completion after a failed or cancelled terminal', async () => {
    for (const status of ['failed', 'cancelled']) {
      const received = await chunks(await send(transport([envelope(0, { type: 'terminal', status })])))
      expect(received).toEqual([expect.objectContaining({ type: 'error' })])
    }
  })

  it('preserves a specific stream error without replacing it with a generic terminal error', async () => {
    const received = await chunks(await send(transport([
      envelope(0, { type: 'error', code: 'revision_conflict', message: '规划已更新，请先比较修改内容' }),
      envelope(1, { type: 'terminal', status: 'failed' }),
    ])))
    expect(received).toEqual([{ type: 'error', errorText: '规划已更新，请先比较修改内容' }])
  })

  it.each(['text/event-stream', 'application/x-ndjson-extra'])('cancels an incompatible successful HTTP response (%s) before rejecting the protocol', async (contentType) => {
    let cancelled = false
    const value = new JsonlChatTransport({
      body: { requestId: 'request-1', planId: 1, conversationId: 1 },
      fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'content-type': contentType } }),
    })
    await expect(send(value)).rejects.toThrow('协议')
    expect(cancelled).toBe(true)
  })
})

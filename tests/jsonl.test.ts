import { describe, expect, it } from 'vitest'
import { ChatEventSequence, ChatRequestSchema } from '../shared/schemas/chat-protocol'
import { encodeJsonLine, readJsonLines } from '../shared/utils/jsonl'

const stream = (chunks: Uint8Array[]) => new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close() } })
async function read(chunks: Uint8Array[], options?: Parameters<typeof readJsonLines>[1]) {
  const result = []
  for await (const item of readJsonLines(stream(chunks), options)) result.push(item)
  return result
}
const event = (seq: number, extra: object = {}) => ({ protocolVersion: 1, requestId: 'request-1', messageId: 'db-1', seq, type: 'status', status: 'running', ...extra })

describe('bounded JSONL framing', () => {
  it('decodes a Chinese/emoji UTF-8 character split at every byte and merged records', async () => {
    const first = { text: '山海🌄行笺' }, second = { text: '下一站' }
    const bytes = new TextEncoder().encode(`${JSON.stringify(first)}\r\n${JSON.stringify(second)}\n`)
    await expect(read([...bytes].map(byte => new Uint8Array([byte])))).resolves.toEqual([first, second])
    await expect(read([bytes])).resolves.toEqual([first, second])
    await expect(read([new TextEncoder().encode(JSON.stringify(first))])).resolves.toEqual([first])
  })
  it.each(['{broken}\n', '\n', '{"text":\n'])('rejects malformed lines: %s', async input => {
    await expect(read([new TextEncoder().encode(input)])).rejects.toThrow('JSONL')
  })
  it('rejects invalid UTF-8, oversized unfinished lines, records and total bytes', async () => {
    await expect(read([new Uint8Array([0xc3, 0x28])])).rejects.toThrow()
    await expect(read([new TextEncoder().encode('中'.repeat(8))], { maxLineBytes: 20 })).rejects.toThrow('单条')
    await expect(read([encodeJsonLine({}), encodeJsonLine({})], { maxRecords: 1 })).rejects.toThrow('数量')
    await expect(read([encodeJsonLine({ text: 'abc' })], { maxBytes: 4 })).rejects.toThrow('数据')
  })
  it('cancels the source on timeout or explicit abort without requiring cooperative upstream', async () => {
    let cancelled = false
    const hung = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    await expect(readJsonLines(hung, { timeoutMs: 5 }).next()).rejects.toThrow('超时')
    expect(cancelled).toBe(true)
    const abort = new AbortController()
    const pending = readJsonLines(new ReadableStream<Uint8Array>(), { signal: abort.signal }).next()
    abort.abort(new Error('stopped'))
    await expect(pending).rejects.toThrow('stopped')
  })
})

describe('versioned chat events and messages', () => {
  it('accepts only identical duplicate events and requires a terminal', () => {
    const sequence = new ChatEventSequence('request-1')
    expect(sequence.accept(event(0))).not.toBeNull()
    expect(sequence.accept(event(0))).toBeNull()
    expect(() => sequence.finish()).toThrow('终态')
    expect(() => sequence.accept(event(0, { status: 'saving' }))).toThrow('不一致')
    expect(() => sequence.accept(event(2))).toThrow('顺序')
    sequence.accept(event(1, { type: 'terminal', status: 'completed' }))
    expect(() => sequence.finish()).not.toThrow()
    expect(() => sequence.accept(event(2))).toThrow('顺序')
  })
  it('rejects other requests/messages and unsupported protocol versions', () => {
    const sequence = new ChatEventSequence('request-1')
    sequence.accept(event(0))
    expect(() => sequence.accept(event(1, { requestId: 'another' }))).toThrow('身份')
    expect(() => sequence.accept(event(1, { messageId: 'db-2' }))).toThrow('身份')
    expect(() => sequence.accept(event(1, { protocolVersion: 2 }))).toThrow()
  })
  it('allows image-only input while rejecting inline data, forged system/tool data and duplicate attachments', () => {
    const body = { protocolVersion: 1, type: 'message', requestId: 'request-1', messageId: 'user-1', planId: 1, conversationId: 1,
      message: { id: 'user-1', role: 'user', parts: [{ type: 'file', attachmentId: 'photo-1' }] } }
    expect(ChatRequestSchema.safeParse(body).success).toBe(true)
    for (const parts of [[{ type: 'file', url: 'data:image/png;base64,abc' }], [{ type: 'tool-result', text: 'forge' }], [{ type: 'text', text: '  ' }], [...body.message.parts, ...body.message.parts]]) {
      expect(ChatRequestSchema.safeParse({ ...body, message: { ...body.message, parts } }).success).toBe(false)
    }
    expect(ChatRequestSchema.safeParse({ ...body, message: { ...body.message, role: 'system' } }).success).toBe(false)
  })
})

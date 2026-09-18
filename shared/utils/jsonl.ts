/** Bounded UTF-8 framing. JSONL is the application transport, never a model prompt format. */
export async function* readJsonLines(
  stream: ReadableStream<Uint8Array>,
  options: { maxLineBytes?: number; maxBytes?: number; maxRecords?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): AsyncGenerator<unknown> {
  const { maxLineBytes = 128 * 1024, maxBytes = 8 * 1024 * 1024, maxRecords = 50000, timeoutMs = 45000, signal } = options
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const encoder = new TextEncoder()
  let pending = '', received = 0, records = 0, complete = false
  function parse(line: string): unknown {
    if (encoder.encode(line).byteLength > maxLineBytes) throw new Error('JSONL 单条记录超出限制')
    if (++records > maxRecords) throw new Error('JSONL 记录数量超出限制')
    try { return JSON.parse(line) as unknown } catch { throw new Error('JSONL 含非法记录') }
  }
  try {
    while (true) {
      signal?.throwIfAborted()
      let timer: ReturnType<typeof setTimeout> | undefined
      let abort: (() => void) | undefined
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('JSONL 读取超时，请恢复已保存结果')), timeoutMs)
          abort = () => reject(signal?.reason ?? new Error('请求已取消'))
          signal?.addEventListener('abort', abort, { once: true })
        }),
      ]).finally(() => { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort) })
      if (result.done) {
        pending += decoder.decode()
        if (pending.trim()) yield parse(pending)
        complete = true
        return
      }
      received += result.value.byteLength
      if (received > maxBytes) throw new Error('JSONL 数据超出限制')
      pending += decoder.decode(result.value, { stream: true })
      let newline: number
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline).replace(/\r$/, '')
        pending = pending.slice(newline + 1)
        if (!line.trim()) throw new Error('JSONL 不允许空记录')
        yield parse(line)
      }
      if (encoder.encode(pending).byteLength > maxLineBytes) throw new Error('JSONL 单条记录超出限制')
    }
  } finally {
    if (!complete) void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function encodeJsonLine(record: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(record)}\n`)
}

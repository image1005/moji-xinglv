import { createError } from 'h3'

/** Bound upstream bodies before parsing. Timeouts cover body reads as well as headers. */
export async function readProviderBytes(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.ok || !response.body) throw createError({ statusCode: 502, statusMessage: `上游服务暂不可用（HTTP ${response.status}）` })
  if (Number(response.headers.get('content-length') || 0) > maxBytes) { await response.body.cancel(); throw createError({ statusCode: 502, statusMessage: '上游响应超出大小限制' }) }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) { await reader.cancel(); throw createError({ statusCode: 502, statusMessage: '上游响应超出大小限制' }) }
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally { reader.releaseLock() }
}
export async function providerJson(url: string | URL, options: RequestInit = {}, maxBytes = 1_000_000): Promise<unknown> {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000)
  return JSON.parse((await readProviderBytes(await fetch(url, { ...options, signal, redirect: 'error' }), maxBytes)).toString('utf8'))
}

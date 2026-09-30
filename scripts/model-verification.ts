/** Shared boundary for separating background version naming from interactive chat probes. */
export type VerificationModelRequest = {
  model?: string
  stream?: boolean
  messages?: { role: string; content: unknown }[]
  tools?: unknown[]
}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content
  return Array.isArray(content) ? content.flatMap(part => part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('') : ''
}

export function isVersionNameRequest(request: VerificationModelRequest): boolean {
  if (request.tools?.length) return false
  const system = request.messages?.filter(message => message.role === 'system').map(message => textContent(message.content)).join('\n') ?? ''
  if (!system.includes('名称独立于行程标题')) return false
  const user = request.messages?.findLast(message => message.role === 'user')
  try {
    const input = JSON.parse(textContent(user?.content)) as Record<string, unknown>
    return !!input.final && typeof input.final === 'object' && 'parent' in input && Array.isArray(input.changes)
  } catch { return false }
}

/** A provider response, not a mocked application API: SDK parsing and the database write remain real. */
export function versionNameFixtureResponse(request: VerificationModelRequest): Response {
  const content = JSON.stringify({ name: '隔离验证行程定稿' })
  const base = { id: `naming-${crypto.randomUUID()}`, created: Math.floor(Date.now() / 1000), model: request.model ?? 'naming-fixture' }
  const usage = { prompt_tokens: 100, completion_tokens: 12, total_tokens: 112 }
  if (!request.stream) return Response.json({ ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage })
  const chunks = [
    { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] },
    { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage },
  ]
  return new Response(`${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
}

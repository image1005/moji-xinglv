/** Local DeepSeek-shaped stream; asserts the documented reasoning/tool continuation contract. */
import { isVersionNameRequest, versionNameFixtureResponse } from './model-verification'

export function startThinkingModel(options: { reasoningMs: number; stallMs: number }) {
  type Message = { role: string; content: string | { type: string; text?: string }[]; reasoning_content?: string; tool_calls?: { function: { name: string } }[] }
  type Payload = { model: string; thinking?: { type: string }; reasoning_effort?: string; max_tokens?: number; messages: Message[]; tools?: { function: { name: string } }[] }
  const state = {
    requests: [] as { marker: string; thinking?: string; effort?: string; maxTokens?: number; searchEnabled: boolean; continuation: boolean; reasoningPreserved: boolean }[],
    namingRequests: 0, completed: 0, cancelled: 0, tools: [] as string[], rejected: [] as string[],
  }
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 120, async fetch(request) {
    if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/chat/completions')) return new Response('not found', { status: 404 })
    const body = await request.json() as Payload
    if (isVersionNameRequest(body)) { state.namingRequests++; return versionNameFixtureResponse(body) }
    const userIndex = body.messages.findLastIndex(message => message.role === 'user')
    const user = body.messages[userIndex]!
    const text = typeof user.content === 'string' ? user.content : user.content.filter(part => part.type === 'text').map(part => part.text).join('')
    const marker = /thinking-case-[\w-]+/.exec(text)?.[0] ?? 'missing-marker'
    const reasoningText = `隔离思考 ${marker}：先核对当前行笺，再整理可执行的旅行建议。`
    const thinking = body.thinking?.type === 'enabled'
    const turn = body.messages.slice(userIndex + 1)
    const assistants = turn.filter(message => message.role === 'assistant' && message.tool_calls?.length)
    const calls = assistants.flatMap(message => message.tool_calls!.map(call => call.function.name))
    const searchEnabled = Boolean(body.tools?.some(tool => tool.function.name === 'search_web'))
    const reasoningPreserved = !thinking || assistants.every(message => Boolean(message.reasoning_content?.startsWith(reasoningText)))
    state.requests.push({ marker, thinking: body.thinking?.type, effort: body.reasoning_effort, maxTokens: body.max_tokens, searchEnabled, continuation: assistants.length > 0, reasoningPreserved })
    if (!reasoningPreserved) {
      state.rejected.push(`${marker}: missing reasoning_content on assistant tool call; ${JSON.stringify(assistants.map(message => ({ tools: message.tool_calls!.map(call => call.function.name), reasoningCharacters: message.reasoning_content?.length ?? 0 })))}`)
      return Response.json({ error: { message: 'Missing reasoning_content field in the assistant message at message index with tool_calls', type: 'invalid_request_error' } }, { status: 400 })
    }
    if (text.includes('fixture-provider-error')) return Response.json({ error: { message: 'Explicit isolated upstream failure', type: 'server_error' } }, { status: 503 })
    const system = body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
    const planId = Number(/planId[：:=]\s*(\d+)/.exec(system)?.[1])
    if (!planId) return Response.json({ error: { message: 'Fixture requires scoped plan id' } }, { status: 400 })
    const hanging = /fixture-stop|fixture-timeout/.test(text)
    const length = text.includes('fixture-length')
    const empty = text.includes('fixture-empty')
    const tool = hanging || length || empty ? null : !calls.includes('get_plan') ? 'get_plan' : searchEnabled && !calls.includes('search_web') ? 'search_web' : null
    if (tool) state.tools.push(tool)
    const id = `thinking-${crypto.randomUUID()}`
    const encoder = new TextEncoder()
    let cancelled = false, finished = false
    let pending: ReturnType<typeof setTimeout> | undefined
    let reasoningTimer: ReturnType<typeof setInterval> | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (delta: object, finishReason: string | null = null) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`))
        const finish = (reason: string) => {
          if (cancelled) return
          clearInterval(reasoningTimer)
          send({}, reason)
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          finished = true
          state.completed++
          controller.close()
        }
        send({ role: 'assistant', content: '' })
        if (thinking) send({ reasoning_content: reasoningText })
        if (hanging) {
          reasoningTimer = setInterval(() => { if (!cancelled) send({ reasoning_content: '隔离持续思考，等待停止或本轮时限。' }) }, 100)
          pending = setTimeout(() => finish('stop'), options.stallMs)
          return
        }
        const delayed = text.includes('fixture-delayed') && !calls.length
        if (delayed) reasoningTimer = setInterval(() => { if (!cancelled) send({ reasoning_content: '继续核对旅行资料。' }) }, 100)
        pending = setTimeout(() => {
          clearInterval(reasoningTimer)
          if (cancelled) return
          if (tool) {
            const input = tool === 'get_plan' ? { planId, section: 'overview' } : { planId, query: `隔离旅行资料 ${marker}` }
            send({ tool_calls: [{ index: 0, id: `${tool}-${crypto.randomUUID()}`, type: 'function', function: { name: tool, arguments: JSON.stringify(input) } }] })
            finish('tool_calls')
          } else {
            if (!length && !empty) send({ content: `隔离正文已完成 ${marker}。已核对当前行笺${searchEnabled ? '及隔离搜索来源' : ''}，可继续发送消息。` })
            finish(length ? 'length' : 'stop')
          }
        }, delayed ? options.reasoningMs : 50)
      },
      cancel() { clearTimeout(pending); clearInterval(reasoningTimer); if (!finished && !cancelled) { cancelled = true; state.cancelled++ } },
    })
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
  } })
  return { server, state, baseURL: `http://127.0.0.1:${server.port}/v1` }
}

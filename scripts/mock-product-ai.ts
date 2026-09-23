/** Deterministic provider fixture. Tool execution, persistence and UI remain real. */
export function startProductModel() {
  const state = { requests: 0, imageRequests: 0, searches: 0, edits: 0, settings: [] as { thinking?: unknown; effort?: unknown }[] }
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 60, async fetch(request) {
    if (!new URL(request.url).pathname.endsWith('/chat/completions')) return new Response('not found', { status: 404 })
    const body = await request.json() as { thinking?: unknown; reasoning_effort?: unknown; messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[]; tool_call_id?: string; tool_calls?: { function: { name: string } }[] }[]; tools?: { function: { name: string } }[] }
    state.requests++
    state.settings.push({ thinking: body.thinking, effort: body.reasoning_effort })
    const system = body.messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
    const planId = Number(/planId[：:=]\s*(\d+)/.exec(system)?.[1])
    if (!planId) return Response.json({ error: { message: 'fixture missing scoped plan id' } }, { status: 400 })
    const latestUser = body.messages.findLastIndex(message => message.role === 'user')
    const user = body.messages[latestUser]!
    const userText = typeof user.content === 'string' ? user.content : user.content.filter(p => p.type === 'text').map(p => p.text).join('')
    if (userText.includes('取消验收')) {
      const encoder = new TextEncoder()
      let timer: ReturnType<typeof setTimeout> | undefined
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const chunk = (delta: object, finish_reason: string | null = null) => encoder.encode(`data: ${JSON.stringify({ id: 'cancellation-fixture', created: 1, model: 'deepseek-flash', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
          controller.enqueue(chunk({ role: 'assistant', content: '隔离取消验收正在生成' }))
          timer = setTimeout(() => { controller.enqueue(chunk({}, 'stop')); controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close() }, 15000)
        },
        cancel() { clearTimeout(timer) },
      }), { headers: { 'content-type': 'text/event-stream' } })
    }
    const imageCount = body.messages.reduce((count, message) => count + (Array.isArray(message.content) ? message.content.filter(p => p.type === 'image_url' && p.image_url?.url.startsWith('data:image/')).length : 0), 0)
    if (imageCount) state.imageRequests++
    const calls = body.messages.slice(latestUser + 1).flatMap(message => message.tool_calls?.map(call => call.function.name) ?? [])
    const canSearch = body.tools?.some(tool => tool.function.name === 'search_web')
    const tool = canSearch && !calls.includes('search_web') ? 'search_web' : !calls.includes('apply_plan_edits') ? 'apply_plan_edits' : null
    if (tool === 'search_web') state.searches++
    if (tool === 'apply_plan_edits') state.edits++
    const edits = /调整|菜单|截图/.test(userText)
      ? [{ target: 'plan', action: 'update', value: { summary: `隔离测试：已按图片追问调整行程（${imageCount} 张上下文图片）` } }]
      : [
          { target: 'plan', action: 'update', value: { summary: '隔离模拟数据：杭州图文行程，所有供应商数据仅供工程验收' } },
          { target: 'day', action: 'add', value: { date: '2026-10-01', city: '杭州', spots: [{ name: '西湖', address: '杭州市西湖区', time: '09:00' }, { name: '断桥', address: '杭州市西湖区北山街', time: '11:00' }], meals: ['东坡肉'], lodging: '市区住宿', transport: '步行与公共交通' } },
          { target: 'food', action: 'add', value: { name: '东坡肉', city: '杭州', meal: 'lunch', status: 'wishlist' } },
        ]
    const input = tool === 'search_web' ? { planId, query: '杭州西湖旅行建议 工程隔离测试' } : { planId, edits }
    const id = `mock-${crypto.randomUUID()}`, created = Math.floor(Date.now() / 1000)
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      const send = (delta: unknown, finish_reason: string | null = null) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, created, model: 'deepseek-flash', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`))
      send({ role: 'assistant', content: '' })
      if (tool) {
        send({ tool_calls: [{ index: 0, id: `${tool}-${crypto.randomUUID()}`, type: 'function', function: { name: tool, arguments: JSON.stringify(input) } }] })
        send({}, 'tool_calls')
      } else {
        send({ content: `隔离模拟模型完成；已接收 ${imageCount} 张上下文图片。行程修改已通过真实结构化工具保存。` })
        send({}, 'stop')
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    } })
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
  } })
  return { server, state, baseURL: `http://127.0.0.1:${server.port}/v1` }
}

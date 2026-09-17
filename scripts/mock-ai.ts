/** 回环地址上的 OpenAI 兼容 SSE 测试服务；不访问网络或读取真实 AI 配置。 */
export function startMockAi() {
  const state = { requests: 0, completed: 0, cancelled: 0 }
  const marker = '浏览器隔离生成已完整结束。'
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0, idleTimeout: 30,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (request.method !== 'POST' || !path.endsWith('/chat/completions')) return new Response('not found', { status: 404 })
      await request.json()
      state.requests++
      let finished = false
      let cancelled = false
      const encoder = new TextEncoder()
      const id = `chatcmpl-${crypto.randomUUID()}`
      const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) => ({
        id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'browser-mock',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
          try {
            send(chunk({ role: 'assistant', content: '' }))
            const pieces = ['正在整理旅行建议。', ...Array.from({ length: 32 }, () => '慢慢走，沿途都有风景。'), marker]
            for (const content of pieces) {
              if (cancelled) return
              send(chunk({ content }))
              await Bun.sleep(180)
            }
            send(chunk({}, 'stop'))
            send({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'browser-mock', choices: [], usage: { prompt_tokens: 100, completion_tokens: 120, total_tokens: 220 } })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            finished = true
            state.completed++
            controller.close()
          } catch {
            if (!cancelled && !finished) { cancelled = true; state.cancelled++ }
          }
        },
        cancel() { if (!finished && !cancelled) { cancelled = true; state.cancelled++ } },
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
    },
  })
  return { server, state, marker, baseURL: `http://127.0.0.1:${server.port}/v1` }
}

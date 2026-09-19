import sharp from 'sharp'
import { modelCapabilities } from '../server/providers/models'

// Explicit opt-in because real requests may be billable. Never print keys, prompts, or provider bodies.
if (!process.argv.includes('--real')) {
  console.log(JSON.stringify({ mode: 'configuration-only', model: process.env.AI_MODEL || 'deepseek-flash', configured: Boolean(process.env.AI_API_KEY), capabilities: modelCapabilities(), next: 'bun run verify:providers --real [--model=deepseek-flash]' }, null, 2))
  process.exit(0)
}
if (!process.env.AI_API_KEY) throw new Error('AI_API_KEY is required')
const model = process.argv.find(arg => arg.startsWith('--model='))?.slice(8) || process.env.AI_MODEL || 'deepseek-flash'
const base = (process.env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ff0000' } }).png().toBuffer()
const probes = process.argv.includes('--roundtrip') ? [] : process.argv.includes('--extended') ? [
  { name: 'thinking-low', body: { thinking: { type: 'enabled' }, reasoning_effort: 'low', messages: [{ role: 'user', content: 'What is 19*23? Reply briefly.' }] } },
  { name: 'thinking-max', body: { thinking: { type: 'enabled' }, reasoning_effort: 'max', messages: [{ role: 'user', content: 'What is 19*23? Reply briefly.' }] } },
] : [
  { name: 'text-off', body: { thinking: { type: 'disabled' }, messages: [{ role: 'user', content: 'Reply OK.' }] } },
  { name: 'tool-call', body: { thinking: { type: 'disabled' }, messages: [{ role: 'user', content: 'Call confirm with value OK.' }], tools: [{ type: 'function', function: { name: 'confirm', description: 'confirm', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } } }], tool_choice: { type: 'function', function: { name: 'confirm' } } } },
  { name: 'vision', body: { thinking: { type: 'disabled' }, messages: [{ role: 'user', content: [{ type: 'text', text: 'What dominant color is the image? Reply with the English color name only.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${image.toString('base64')}` } }] }] } },
  { name: 'thinking-high', body: { thinking: { type: 'enabled' }, reasoning_effort: 'high', messages: [{ role: 'user', content: 'What is 19*23? Reply briefly.' }] } },
]
for (const probe of probes) {
  const start = Date.now()
  try {
    const response = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 256, ...probe.body }), signal: AbortSignal.timeout(45_000) })
    const body = await response.json() as { model?: string; choices?: Array<{ finish_reason?: string; message?: { content?: string; reasoning_content?: string; tool_calls?: unknown[] } }>; error?: { code?: string | number }; usage?: { total_tokens?: number } }
    const choice = body.choices?.[0]
    console.log(JSON.stringify({ probe: probe.name, requestedModel: model, actualModel: body.model, status: response.status, durationMs: Date.now() - start, finishReason: choice?.finish_reason, tokens: body.usage?.total_tokens, contentPresent: Boolean(choice?.message?.content), reasoningPresent: Boolean(choice?.message?.reasoning_content), toolCallPresent: Boolean(choice?.message?.tool_calls?.length), visionAnswerCorrect: probe.name === 'vision' ? /red/i.test(choice?.message?.content || '') : undefined, errorCode: body.error?.code }))
  } catch (error) { console.log(JSON.stringify({ probe: probe.name, requestedModel: model, status: 'unreachable', durationMs: Date.now() - start, errorType: error instanceof Error ? error.name : 'Error' })) }
}
if (process.argv.includes('--roundtrip')) {
  const tools = [{ type: 'function', function: { name: 'confirm', description: 'Confirm the token', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } } }]
  const messages: unknown[] = [{ role: 'user', content: 'Call confirm with value OK, then acknowledge its result.' }]
  for (let step = 0; step < 2; step++) {
    try {
      const response = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 256, thinking: { type: 'enabled' }, reasoning_effort: 'low', messages, tools }), signal: AbortSignal.timeout(45_000) })
      const body = await response.json() as { model?: string; choices?: Array<{ finish_reason?: string; message?: { content?: string; reasoning_content?: string; tool_calls?: Array<{ id: string }> } }>; usage?: { total_tokens?: number } }
      const message = body.choices?.[0]?.message
      console.log(JSON.stringify({ probe: `reasoning-tool-step-${step + 1}`, status: response.status, actualModel: body.model, tokens: body.usage?.total_tokens, reasoningPresent: Boolean(message?.reasoning_content), toolCallPresent: Boolean(message?.tool_calls?.length), contentPresent: Boolean(message?.content) }))
      if (!response.ok || !message) break
      messages.push(message)
      const call = message.tool_calls?.[0]
      if (!call) break
      messages.push({ role: 'tool', tool_call_id: call.id, content: 'OK' })
    } catch (error) { console.log(JSON.stringify({ probe: `reasoning-tool-step-${step + 1}`, status: 'unreachable', errorType: error instanceof Error ? error.name : 'Error' })); break }
  }
}

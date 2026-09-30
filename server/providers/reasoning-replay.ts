import type { LanguageModelV2Middleware, LanguageModelV2ReasoningPart, LanguageModelV2StreamPart } from '@ai-sdk/provider'
import { aiConfig } from '../utils/ai-config'
import { assertReasoningBudget } from '../utils/reasoning-budget'

/** Mastra 1.66 merges equal reasoning text across steps. DeepSeek requires it on each tool turn.
 * Keep exact provider output per tool call inside this model/run; never invent reasoning or item IDs.
 */
export function preserveToolReasoning(): LanguageModelV2Middleware {
  const byToolCall = new Map<string, LanguageModelV2ReasoningPart[]>()
  return {
    transformParams: async ({ params }) => {
      const prompt = params.prompt.map(message => {
        if (message.role !== 'assistant') return message
        const snapshots = new Set(message.content.flatMap(part => {
          const captured = part.type === 'tool-call' ? byToolCall.get(part.toolCallId) : undefined
          return captured ? [captured] : []
        }))
        if (!snapshots.size) return message
        return { ...message, content: [...structuredClone([...snapshots].flat()), ...message.content.filter(part => part.type !== 'reasoning')] }
      })
      assertReasoningBudget(prompt, aiConfig().AI_REASONING_MAX_BYTES)
      return { ...params, prompt }
    },
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()
      const reasoning = result.content.flatMap(part => part.type === 'reasoning' ? [{ type: 'reasoning' as const, text: part.text, ...(part.providerMetadata ? { providerOptions: part.providerMetadata } : {}) }] : [])
      for (const part of result.content) if (part.type === 'tool-call' && reasoning.length) byToolCall.set(part.toolCallId, reasoning)
      return result
    },
    wrapStream: async ({ doStream }) => {
      const result = await doStream()
      const reasoning = new Map<string, LanguageModelV2ReasoningPart>()
      const calls = new Set<string>()
      return { ...result, stream: result.stream.pipeThrough(new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
        transform(part, controller) {
          if (part.type === 'reasoning-start' || part.type === 'reasoning-delta' || part.type === 'reasoning-end') {
            const captured = reasoning.get(part.id) ?? { type: 'reasoning' as const, text: '' }
            if (part.type === 'reasoning-delta') captured.text += part.delta
            if (part.providerMetadata) captured.providerOptions = { ...captured.providerOptions, ...part.providerMetadata }
            reasoning.set(part.id, captured)
          }
          if (part.type === 'tool-call') calls.add(part.toolCallId)
          if (part.type === 'finish' && reasoning.size) {
            const captured = structuredClone([...reasoning.values()])
            for (const id of calls) byToolCall.set(id, captured)
          }
          controller.enqueue(part)
        },
      })) }
    },
  }
}

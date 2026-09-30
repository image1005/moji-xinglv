import type { LanguageModelV2Prompt } from '@ai-sdk/provider'
import { jsonBytes } from '../services/ai-context'
import { markActionable } from './errors'

/** Full protocol replay, including provider metadata, is measured without truncation. */
export function assertReasoningBudget(prompt: LanguageModelV2Prompt, maxBytes: number) {
  const bytes = prompt.reduce((total, message) => message.role === 'assistant'
    ? total + message.content.reduce((size, part) => size + (part.type === 'reasoning' ? jsonBytes(part) + 1 : 0), 0)
    : total, 0)
  if (bytes > maxBytes) throw markActionable('本轮思考续传内容超过独立的 AI 思考输入预算，已保存的修改会保留。请分成更小的任务继续。')
}

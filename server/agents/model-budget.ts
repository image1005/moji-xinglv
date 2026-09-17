import type { LanguageModelV2Prompt } from '@ai-sdk/provider'
import { jsonBytes } from '../services/ai-context'
import { markActionable } from '../utils/errors'

/** Compact only redundant mutation previews in provider requests; UI and DB retain the full preview. */
export function boundModelPrompt(prompt: LanguageModelV2Prompt, toolBytes: number, maxBytes: number): LanguageModelV2Prompt {
  const bounded = structuredClone(prompt)
  const reads = []
  for (const message of bounded) {
    if (message.role === 'system' || message.role === 'user') continue
    for (const part of message.content) {
      if (part.type !== 'tool-result' || part.output.type !== 'json' || !part.output.value || typeof part.output.value !== 'object' || Array.isArray(part.output.value)) continue
      if (part.toolName === 'apply_plan_edits' || part.toolName === 'patch_plan_json') {
        delete part.output.value.preview
        part.output.value.contextNote = '完整预览已保存并发送到界面；更多规划事实可用 get_plan 按模块读取。'
      }
      if (part.toolName === 'get_plan') reads.push(part)
    }
  }
  // Keep the most recent read intact, and preserve every tool-call/result pair for protocol validity.
  for (const part of reads.slice(0, -1)) {
    if (jsonBytes(bounded) + toolBytes <= maxBytes) break
    part.output = { type: 'json', value: { contextNote: '较早读取内容因输入预算省略；修改涉及这些条目时必须用 get_plan 重读。' } }
  }
  if (jsonBytes(bounded) + toolBytes > maxBytes) throw markActionable('本轮读取内容已超过 AI 输入预算，已保存的修改会保留。请分成更小的任务继续。')
  return bounded
}

import type { LanguageModelV2Prompt } from '@ai-sdk/provider'
import { jsonBytes } from '../services/ai-context'
import { markActionable } from '../utils/errors'
import { aiConfig } from '../utils/ai-config'

/** Image bytes are measured separately, never JSON-stringified into the text budget. */
function promptTextBytes(prompt: LanguageModelV2Prompt): number {
  let imageBytes = 0; let imageCount = 0
  const textPrompt = prompt.map(message => message.role === 'system' ? message : ({ ...message, content: message.content.map(part => {
    if (part.type !== 'file' || !part.mediaType.startsWith('image/')) return part
    imageCount++
    const data = part.data
    const encoded = data instanceof URL && data.protocol === 'data:' ? data.href.slice(data.href.indexOf(',') + 1) : typeof data === 'string' ? data : ''
    const bytes = data instanceof Uint8Array ? data.byteLength : Math.ceil(encoded.length * 3 / 4)
    imageBytes += bytes
    return { ...part, data: `[image ${bytes} bytes]` }
  }) }))
  const config = aiConfig()
  if (imageBytes > config.AI_INPUT_MAX_IMAGE_BYTES || imageCount > config.AI_INPUT_MAX_IMAGES) throw markActionable('本轮图片超过模型输入预算，请减少图片或开启新会话。已保存的附件不会丢失。')
  return jsonBytes(textPrompt)
}

/** Compact only redundant mutation previews in provider requests; UI and DB retain the full preview. */
export function boundModelPrompt(prompt: LanguageModelV2Prompt, toolBytes: number, maxBytes: number): LanguageModelV2Prompt {
  // Mastra may normalize inline images to URL objects. Bun's structuredClone rejects URL,
  // so clone the only mutable JSON tool outputs separately and preserve the file representation.
  const bounded: LanguageModelV2Prompt = prompt.map(message => message.role === 'system' ? { ...message } : ({
    ...message, content: message.content.map(part => part.type === 'file'
      ? { ...part, data: part.data instanceof URL ? new URL(part.data.href) : part.data instanceof Uint8Array ? part.data.slice() : part.data }
      : structuredClone(part)),
  })) as LanguageModelV2Prompt
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
    if (promptTextBytes(bounded) + toolBytes <= maxBytes) break
    part.output = { type: 'json', value: { contextNote: '较早读取内容因输入预算省略；修改涉及这些条目时必须用 get_plan 重读。' } }
  }
  if (promptTextBytes(bounded) + toolBytes > maxBytes) throw markActionable('本轮读取内容已超过 AI 输入预算，已保存的修改会保留。请分成更小的任务继续。')
  return bounded
}

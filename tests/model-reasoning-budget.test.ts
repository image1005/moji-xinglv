import { describe, expect, it } from 'vitest'
import type { LanguageModelV2Prompt } from '@ai-sdk/provider'
import { jsonBytes } from '../server/services/ai-context'
import { boundModelPrompt } from '../server/agents/model-budget'

function planningPrompt(): LanguageModelV2Prompt {
  const reasoning = ['思'.repeat(23000) + 'r'.repeat(10262), 'r'.repeat(34), 'r'.repeat(35)]
  const prompt: LanguageModelV2Prompt = [
    { role: 'system', content: 's'.repeat(2000) },
    { role: 'user', content: [{ type: 'text', text: '安排七天行程，分批提交后总结。' }] },
  ]
  for (const [index, text] of reasoning.entries()) {
    prompt.push({ role: 'assistant', content: [
      { type: 'reasoning', text, providerOptions: { deepseek: { signature: `reasoning-${index}` } } },
      { type: 'tool-call', toolCallId: `edit-${index}`, toolName: 'apply_plan_edits', input: { planId: 41, edits: [{ target: 'plan', action: 'update', value: { summary: 'p'.repeat(1100) } }] } },
    ] })
    prompt.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: `edit-${index}`, toolName: 'apply_plan_edits', output: { type: 'json', value: { ok: true, revision: index + 1, summary: 'p'.repeat(300) } } }] })
  }
  return prompt
}

describe('思考续传的独立字节预算', () => {
  it('复现约33331字符思考加三次编辑挤满旧96KB预算；完整保留思考和工具结果后继续', () => {
    const prompt = planningPrompt()
    const toolsBytes = 10000
    expect(jsonBytes(prompt) + toolsBytes).toBeGreaterThan(96000)
    const bounded = boundModelPrompt(prompt, toolsBytes, 96000)
    const thoughts = (messages: LanguageModelV2Prompt) => messages.flatMap(message => message.role === 'assistant' ? message.content.filter(part => part.type === 'reasoning') : [])
    expect(thoughts(bounded)).toEqual(thoughts(prompt))
    expect(thoughts(bounded).reduce((length, part) => length + part.text.length, 0)).toBe(33331)
    expect(bounded.filter(message => message.role === 'tool')).toHaveLength(3)
    expect(bounded.filter(message => message.role === 'assistant').flatMap(message => message.content.filter(part => part.type === 'tool-call')).map(part => part.toolCallId)).toEqual(['edit-0', 'edit-1', 'edit-2'])
  })
  it('思考续传自身超限明确失败且不截断或修改原输入', () => {
    const prompt = planningPrompt()
    const original = structuredClone(prompt)
    expect(() => boundModelPrompt(prompt, 10000, 96000, 32000)).toThrow('思考续传内容超过独立的 AI 思考输入预算')
    expect(prompt).toEqual(original)
  })
  it('更大的思考额度不能用来放宽非思考输入、工具契约和元数据', () => {
    const prompt = planningPrompt()
    prompt.push({ role: 'user', content: [{ type: 'text', text: '用户事实'.repeat(10000) }] })
    expect(() => boundModelPrompt(prompt, 10000, 96000, 524288)).toThrow('超过 AI 输入预算')
    expect(() => boundModelPrompt(planningPrompt(), 96000, 96000, 524288)).toThrow('超过 AI 输入预算')
    const signed: LanguageModelV2Prompt = [{ role: 'assistant', content: [{ type: 'reasoning', text: 'x', providerOptions: { deepseek: { signature: '元'.repeat(1000) } } }] }]
    expect(() => boundModelPrompt(signed, 0, 96000, 2000)).toThrow('思考续传内容超过独立的 AI 思考输入预算')
  })
})

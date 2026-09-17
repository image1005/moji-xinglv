import { describe, expect, it } from 'vitest'
import { emptyPlan, PlanSchema } from '../shared/schemas/plan'
import { trustedHistory } from '../shared/schemas/chat'
import { jsonBytes, planContext, selectPlanContext } from '../server/services/ai-context'
import { boundModelPrompt } from '../server/agents/model-budget'
import type { LanguageModelV2Prompt } from '@ai-sdk/provider'

describe('AI 输入预算与按需规划事实', () => {
  it('中文长历史有总字节预算，保留完整当前要求与带消息来源的历史约束', () => {
    const records = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, conversationId: 1, role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `${i === 0 ? '用户要求：总预算不超过两千元，带老人慢行。' : '历史规划建议：'}${'长对话'.repeat(1000)}`, createdAt: '' }))
    const latest = '当前要求：把第三天下午改为休息，保留已订住宿。'
    const result = trustedHistory(records, latest, 24000)
    expect(jsonBytes(result)).toBeLessThanOrEqual(24000)
    expect(result.at(-1)?.parts[0]?.text).toBe(latest)
    expect(JSON.stringify(result)).toContain('总预算不超过两千元')
    expect(JSON.stringify(result)).toContain('db-1')
    expect(result.every(item => item.role !== ('system' as string))).toBe(true)
  })

  it('当前消息单独超预算明确拒绝而非悄悄截断', () => {
    expect(() => trustedHistory([], '不可丢失的当前约束'.repeat(500), 1000)).toThrow('超过 AI 输入预算')
  })

  it('每次模型请求计入工具定义，压缩重复预览且不改界面原始结果', () => {
    const prompt: LanguageModelV2Prompt = [
      { role: 'system', content: '必须遵循全部行程Schema' },
      { role: 'user', content: [{ type: 'text', text: '保留住宿，调整路线' }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'edit1', toolName: 'apply_plan_edits', output: { type: 'json', value: { ok: true, revision: 5, preview: { days: '巨大的完整预览'.repeat(20000) } } } }] },
    ]
    const bounded = boundModelPrompt(prompt, 12000, 16000)
    expect(jsonBytes(bounded) + 12000).toBeLessThanOrEqual(16000)
    expect(JSON.stringify(bounded)).toContain('"revision":5')
    expect(JSON.stringify(prompt)).toContain('巨大的完整预览')
    expect(() => boundModelPrompt(prompt, 16000, 16000)).toThrow('超过 AI 输入预算')
  })

  it('长行程概要有界，分页工具仍能取得每个完整景点与食记', () => {
    const plan = PlanSchema.parse({ ...emptyPlan('三十天旅行'), days: Array.from({ length: 30 }, (_, day) => ({ city: `城市${day}`, spots: Array.from({ length: 20 }, (_, spot) => ({ name: `景点${day}-${spot}`, notes: '备注'.repeat(300) })) })) })
    expect(new TextEncoder().encode(planContext(plan)).byteLength).toBeLessThanOrEqual(16000)
    expect(selectPlanContext(plan, 'all')).toHaveProperty('partial', true)
    const collected: unknown[] = []
    for (let offset = 0; offset < 20; offset += 5) {
      const page = selectPlanContext(plan, 'day', 12, offset, 5)
      if ('day' in page) collected.push(...page.day!.spots)
    }
    expect(collected).toEqual(plan.days[12]!.spots)
    expect(selectPlanContext(plan, 'day', 100)).toHaveProperty('day', null)
  })
})

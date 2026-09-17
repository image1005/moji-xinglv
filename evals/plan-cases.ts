import { PlanSchema, type Plan } from '../shared/schemas/plan'
import type { PlanEditOp } from '../shared/utils/plan-edits'
import { applyPlanEditOps } from '../shared/utils/plan-edits'

export const evaluationPlan = (): Plan => PlanSchema.parse({
  title: '江南两日', summary: '慢游', budget: { total: 1000, currency: 'CNY' }, tags: ['人文'],
  days: [{ city: '杭州', date: '2026-10-01', spots: [{ name: '西湖' }, { name: '老街' }] }, { city: '苏州', date: '2026-10-02' }],
  foodJournal: [{ id: 'food-1', name: '面条' }], checklist: [{ id: 'check-1', text: '带雨伞' }],
})
export interface EvaluationCase {
  name: string; prompt: string; edits: PlanEditOp[]; path?: string; value?: unknown; reject?: boolean
}
const one = (name: string, prompt: string, edit: PlanEditOp, path: string, value: unknown): EvaluationCase => ({ name, prompt, edits: [edit], path, value })
export const evaluationCases: EvaluationCase[] = [
  one('title', '把行程标题改为秋日江南。', { target: 'plan', action: 'update', value: { title: '秋日江南' } }, 'title', '秋日江南'),
  one('summary', '把行程简介改为轻松出游。', { target: 'plan', action: 'update', value: { summary: '轻松出游' } }, 'summary', '轻松出游'),
  one('budget', '把总预算改为2000元，其他内容保留。', { target: 'plan', action: 'update', value: { budget: { total: 2000 } } }, 'budget.total', 2000),
  one('tags', '行程标签只保留亲子。', { target: 'plan', action: 'update', value: { tags: ['亲子'] } }, 'tags', ['亲子']),
  one('tips', '行前提示设为提前预约这一条。', { target: 'plan', action: 'update', value: { tips: ['提前预约'] } }, 'tips', ['提前预约']),
  one('add-day', '最后增加一天南京行程，暂不安排景点。', { target: 'day', action: 'add', value: { city: '南京' } }, 'days.2.city', '南京'),
  one('update-day', '第二天城市改为南京，其他内容保留。', { target: 'day', action: 'update', index: 1, value: { city: '南京' } }, 'days.1.city', '南京'),
  one('remove-day', '删除第二天的安排。', { target: 'day', action: 'remove', index: 1 }, 'days.length', 1),
  one('move-day', '把第二天的安排移到第一天。', { target: 'day', action: 'move', index: 1, to: 0 }, 'days.0.city', '苏州'),
  one('add-spot', '第一天最后加一个地点书店，坐标未知。', { target: 'spot', action: 'add', day: 0, value: { name: '书店' } }, 'days.0.spots.2.name', '书店'),
  one('rename-spot', '第一天的老街改名为河坊街。', { target: 'spot', action: 'update', day: 0, index: 1, value: { name: '河坊街' } }, 'days.0.spots.1.name', '河坊街'),
  one('move-spot', '第一天先去老街再去西湖。', { target: 'spot', action: 'move', day: 0, index: 1, to: 0 }, 'days.0.spots.0.name', '老街'),
  one('remove-spot', '删除第一天的老街。', { target: 'spot', action: 'remove', day: 0, index: 1 }, 'days.0.spots.length', 1),
  one('duration', '西湖停留时间改为120分钟。', { target: 'spot', action: 'update', day: 0, index: 0, value: { durationMinutes: 120 } }, 'days.0.spots.0.durationMinutes', 120),
  one('cost', '我为西湖安排的花费预算是50元，请记录。', { target: 'spot', action: 'update', day: 0, index: 0, value: { cost: 50 } }, 'days.0.spots.0.cost', 50),
  one('coordinates', '我提供西湖的BD09坐标为经度120.15纬度30.24，请录入。', { target: 'spot', action: 'update', day: 0, index: 0, value: { lng: 120.15, lat: 30.24 } }, 'days.0.spots.0.lat', 30.24),
  one('add-food', '食记中增加想吃的藕粉，不填写评分。', { target: 'food', action: 'add', value: { name: '藕粉' } }, 'foodJournal.1.name', '藕粉'),
  one('update-food', '将面条食记名称改为苏式面。', { target: 'food', action: 'update', id: 'food-1', value: { name: '苏式面' } }, 'foodJournal.0.name', '苏式面'),
  one('food-status', '我已经吃过面条，将它标记为已尝。', { target: 'food', action: 'status', id: 'food-1', status: 'tasted' }, 'foodJournal.0.status', 'tasted'),
  one('remove-food', '删除面条这条食记。', { target: 'food', action: 'remove', id: 'food-1' }, 'foodJournal.length', 0),
  one('add-check', '在清单里增加携带充电器。', { target: 'checklist', action: 'add', text: '携带充电器' }, 'checklist.1.text', '携带充电器'),
  one('toggle-check', '我已带好雨伞，将带雨伞标为完成。', { target: 'checklist', action: 'toggle', id: 'check-1', value: { done: true } }, 'checklist.0.done', true),
  one('remove-check', '删除带雨伞这个清单项。', { target: 'checklist', action: 'remove', id: 'check-1' }, 'checklist.length', 0),
  one('meals', '第一天用餐建议只写午餐吃面。', { target: 'day', action: 'update', index: 0, value: { meals: ['午餐吃面'] } }, 'days.0.meals', ['午餐吃面']),
  one('transport', '第一天交通备注设为地铁。', { target: 'day', action: 'update', index: 0, value: { transport: '地铁' } }, 'days.0.transport', '地铁'),
  one('lodging', '第一天住宿备注设为住市中心。', { target: 'day', action: 'update', index: 0, value: { lodging: '住市中心' } }, 'days.0.lodging', '住市中心'),
  one('rating', '我给面条打4分，请记录我的评分。', { target: 'food', action: 'update', id: 'food-1', value: { rating: 4 } }, 'foodJournal.0.rating', 4),
  { name: 'unknown-field', prompt: '拒绝未知stay字段', edits: [{ target: 'day', action: 'update', index: 0, value: { stay: '酒店' } }], reject: true },
  { name: 'invalid-index', prompt: '拒绝不存在的日期下标', edits: [{ target: 'spot', action: 'add', day: 99, value: { name: '公园' } }], reject: true },
  { name: 'partial-coordinates', prompt: '拒绝只填写经度', edits: [{ target: 'spot', action: 'update', day: 0, index: 0, value: { lng: 120 } }], reject: true },
]

export function matchesEvaluation(plan: Plan, entry: EvaluationCase): boolean {
  if (entry.reject) return false
  let value: unknown = plan
  for (const key of (entry.path ?? '').split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
  if (JSON.stringify(value) !== JSON.stringify(entry.value)) return false
  const baseline = evaluationPlan()
  const expected = PlanSchema.parse(applyPlanEditOps(baseline, entry.edits))
  const normalize = (input: Plan) => {
    const output = PlanSchema.parse(input)
    for (const field of ['foodJournal', 'checklist'] as const) {
      const existing = new Set(baseline[field].map(item => item.id))
      output[field].forEach((item, index) => { if (!existing.has(item.id)) item.id = `generated-${index}` })
    }
    return output
  }
  // A matching target field alone must not conceal collateral changes elsewhere in the plan.
  return JSON.stringify(normalize(plan)) === JSON.stringify(normalize(expected))
}

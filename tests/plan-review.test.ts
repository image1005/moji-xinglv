import { describe, expect, it } from 'vitest'
import { PlanSchema } from '../shared/schemas/plan'
import { reviewPlan } from '../shared/utils/plan-review'

describe('行程可行性检查', () => {
  it('识别非法日历日期、重复日期和乱序', () => {
    const plan = PlanSchema.parse({ title: '日期', days: [
      { date: '2026-02-30' }, { date: '2026-03-02' }, { date: '2026-03-02' }, { date: '2026-03-01' },
    ] })
    expect(reviewPlan(plan).map((issue) => issue.code)).toEqual(['invalid-date', 'date-order', 'date-order'])
  })
  it('识别重复地点、时间重叠与密集安排，同时保留未定位提示', () => {
    const plan = PlanSchema.parse({ title: '行程', days: [{ spots: [
      { name: '西湖', time: '09:00', durationMinutes: 360 },
      { name: '西湖', time: '10:00', durationMinutes: 360 },
    ] }] })
    expect(reviewPlan(plan).map((issue) => issue.code)).toEqual(['duplicate-spot', 'time-overlap', 'dense-day', 'missing-coordinates'])
  })
  it('预算只比较分类，不重复累加景点与美食记账', () => {
    const plan = PlanSchema.parse({ title: '预算', budget: { total: 100, breakdown: { 餐饮: 100 } }, foodJournal: [{ id: 'one', name: '午餐', cost: 100 }] })
    expect(reviewPlan(plan)).toEqual([])
    plan.budget.total = 120
    expect(reviewPlan(plan)[0]?.code).toBe('budget-mismatch')
  })
  it('空日期与文字时间不捏造错误，可接受有效闰日', () => {
    expect(reviewPlan(PlanSchema.parse({ title: '自由安排', days: [{ date: '2028-02-29', spots: [{ name: '公园', time: '午后', lng: 120, lat: 30 }] }] }))).toEqual([])
  })
})

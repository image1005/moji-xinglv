import { describe, expect, it } from 'vitest'
import { PlanSchema, SpotSchema, formatPlanIssues } from '../shared/schemas/plan'

describe('行程契约的未知字段边界', () => {
  it('拒绝未知字段而不是静默丢弃', () => {
    expect(PlanSchema.safeParse({ title: 'a', planId: 6 }).success).toBe(false)
    const day = PlanSchema.safeParse({ title: 'a', days: [{ stay: '湖滨民宿' }] })
    expect(day.success).toBe(false)
    const spot = SpotSchema.safeParse({ name: '断桥', duration: '1.5 小时' })
    expect(spot.success).toBe(false)
    const root = PlanSchema.safeParse({ title: 'a', days: [{ spots: [{ name: 'x', lng: null, lat: null, theme: '晨游' }] }] })
    expect(root.success).toBe(false)
  })

  it('历史缺字段的旧行程仍按默认值兼容', () => {
    const plan = PlanSchema.parse({ title: '江南', days: [{ spots: [{ name: '西湖', lng: 120.15, lat: 30.24 }] }] })
    expect(plan.foodJournal).toEqual([])
    expect(plan.checklist).toEqual([])
    expect(plan.days[0]?.spots[0]?.durationMinutes).toBe(60)
    expect(plan.days[0]?.spots[0]?.category).toBe('sight')
  })

  it('未知字段报错给出改名建议', () => {
    const result = PlanSchema.safeParse({ title: 'a', days: [{ stay: '湖滨民宿' }] })
    expect(result.success).toBe(false)
    if (result.success) return
    const text = formatPlanIssues(result.error.issues)
    expect(text).toContain('stay')
    expect(text).toContain('lodging')
    expect(text).toContain('days')
  })

  it('常见类型错误同样带提示', () => {
    const result = PlanSchema.safeParse({
      title: 'a',
      budget: { total: 1, currency: 'CNY', breakdown: [] },
      foodJournal: [{ id: 'x', name: '片儿川', rating: null }],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    const text = formatPlanIssues(result.error.issues)
    expect(text).toContain('breakdown')
    expect(text).toContain('0')
  })
})

import { describe, expect, it } from 'vitest'
import { PlanSchema, type Plan } from '../shared/schemas/plan'
import { applyPlanEditOps, PlanEditError, type PlanEditOp } from '../shared/utils/plan-edits'

function base(): Plan {
  return PlanSchema.parse({
    title: '江南',
    days: [{ city: '杭州', spots: [{ name: '西湖', lng: 120.15, lat: 30.24 }, { name: '灵隐寺' }] }],
    foodJournal: [{ id: 'f1', name: '片儿川' }],
    checklist: [{ id: 'c1', text: '带伞' }],
  })
}

function apply(ops: PlanEditOp[]) {
  return applyPlanEditOps(base(), ops)
}

describe('原子编辑操作', () => {
  it('日程增改删移', () => {
    const added = apply([{ target: 'day', action: 'add', value: { city: '苏州' } }])
    expect(added.days).toHaveLength(2)
    const updated = apply([{ target: 'day', action: 'update', index: 0, value: { transport: '地铁 1 号线' } }])
    expect(updated.days[0]!.transport).toBe('地铁 1 号线')
    expect(updated.days[0]!.city).toBe('杭州')
    const moved = apply([
      { target: 'day', action: 'add', value: { city: '苏州' } },
      { target: 'day', action: 'move', index: 1, to: 0 },
    ])
    expect(moved.days[0]!.city).toBe('苏州')
    expect(apply([{ target: 'day', action: 'remove', index: 0 }]).days).toHaveLength(0)
  })

  it('景点增改删移并可用 null 清空坐标', () => {
    const added = apply([{ target: 'spot', action: 'add', day: 0, value: { name: '郭庄', durationMinutes: 90 } }])
    expect(added.days[0]!.spots).toHaveLength(3)
    expect(added.days[0]!.spots[2]!.durationMinutes).toBe(90)
    const updated = apply([
      { target: 'spot', action: 'update', day: 0, index: 0, value: { time: '09:00', lng: null, lat: null } },
    ])
    expect(updated.days[0]!.spots[0]!.time).toBe('09:00')
    expect(updated.days[0]!.spots[0]!.lng).toBeNull()
    const moved = apply([{ target: 'spot', action: 'move', day: 0, index: 1, to: 0 }])
    expect(moved.days[0]!.spots[0]!.name).toBe('灵隐寺')
    expect(apply([{ target: 'spot', action: 'remove', day: 0, index: 0 }]).days[0]!.spots).toHaveLength(1)
  })

  it('行程资料部分字段合并且保留其他预算字段', () => {
    const plan = apply([{ target: 'plan', action: 'update', value: { tags: ['江南'], budget: { total: 1200 } } }])
    expect(plan.tags).toEqual(['江南'])
    expect(plan.budget.total).toBe(1200)
    expect(plan.budget.currency).toBe('CNY')
  })

  it('食记增改删与状态切换', () => {
    const added = apply([{ target: 'food', action: 'add', value: { name: '定胜糕' } }])
    expect(added.foodJournal[1]!.status).toBe('wishlist')
    expect(added.foodJournal[1]!.id).toMatch(/\w{8}/)
    expect(apply([{ target: 'food', action: 'update', id: 'f1', value: { restaurant: '奎元馆' } }]).foodJournal[0]!.restaurant).toBe('奎元馆')
    expect(apply([{ target: 'food', action: 'status', id: 'f1', status: 'tasted' }]).foodJournal[0]!.status).toBe('tasted')
    expect(apply([{ target: 'food', action: 'remove', id: 'f1' }]).foodJournal).toHaveLength(0)
  })

  it('清单增删勾选', () => {
    const added = apply([{ target: 'checklist', action: 'add', text: ' 预约门票 ' }])
    expect(added.checklist[1]!.text).toBe('预约门票')
    expect(added.checklist[1]!.done).toBe(false)
    expect(apply([{ target: 'checklist', action: 'toggle', id: 'c1' }]).checklist[0]!.done).toBe(true)
    expect(apply([{ target: 'checklist', action: 'remove', id: 'c1' }]).checklist).toHaveLength(0)
  })

  it('错误信息带操作序号与允许范围', () => {
    expect(() => apply([{ target: 'day', action: 'update', index: 9, value: {} }])).toThrow(PlanEditError)
    try {
      apply([{ target: 'plan', action: 'update', value: {} }, { target: 'spot', action: 'remove', day: 0, index: 5 }])
      throw new Error('应当失败')
    } catch (error) {
      expect(String(error)).toContain('第 2 项编辑')
    }
    expect(() => apply([{ target: 'plan', action: 'add', value: {} }])).toThrow(/不支持 plan\/add/)
    expect(() => apply([{ target: 'food', action: 'status', id: 'f1' }])).toThrow(/status/)
    expect(() => apply([{ target: 'checklist', action: 'add', text: '  ' }])).toThrow(/text/)
    expect(() => apply([{ target: 'spot', action: 'add', day: 0, value: {} }])).toThrow(/景点字段不合法/)
  })

  it('失败行程参数给出类型、枚举和字段层级提示；修正后整批可执行', () => {
    const original = base()
    expect(() => applyPlanEditOps(original, [
      { target: 'plan', action: 'update', value: { title: '本批尚未保存' } },
      { target: 'day', action: 'add', value: { meals: '午餐和晚餐' } },
    ])).toThrow(/第 2 项编辑.*meals 必须是字符串数组/)
    expect(original.title).toBe('江南')
    expect(original.days).toHaveLength(1)
    expect(() => apply([{ target: 'food', action: 'add', value: { name: '小吃', meal: '午餐' } }]))
      .toThrow(/breakfast、lunch、dinner 或 snack/)
    expect(() => apply([{ target: 'checklist', action: 'add', value: { text: '预约' } }]))
      .toThrow(/操作顶层 text/)
    const corrected = PlanSchema.parse(apply([
      { target: 'day', action: 'add', value: { meals: ['午餐', '晚餐'] } },
      { target: 'food', action: 'add', value: { name: '小吃', meal: 'snack' } },
      { target: 'checklist', action: 'add', text: '预约' },
    ]))
    expect(corrected.days[1]?.meals).toEqual(['午餐', '晚餐'])
    expect(corrected.foodJournal[1]?.meal).toBe('snack')
    expect(corrected.checklist[1]?.text).toBe('预约')
  })
})

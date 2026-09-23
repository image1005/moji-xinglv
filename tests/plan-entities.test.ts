import { describe, expect, it } from 'vitest'
import { PlanSchema } from '../shared/schemas/plan'
import { ensurePlanEntityIds, planEntities } from '../shared/utils/plan-entities'
import { applyPlanEditOps } from '../shared/utils/plan-edits'

describe('稳定地点身份', () => {
  const historical = PlanSchema.parse({ title: '杭州', days: [{ city: '杭州', spots: [{ name: '西湖' }, { name: '断桥' }] }] })
  it('历史读取确定性补ID，排序和唯一匹配不改变身份', () => {
    const first = ensurePlanEntityIds(historical)
    expect(ensurePlanEntityIds(historical)).toEqual(first)
    const reordered = structuredClone(historical)
    reordered.days[0]!.spots.reverse()
    const second = ensurePlanEntityIds(reordered, first)
    expect(second.days[0]!.spots[0]!.id).toBe(first.days[0]!.spots[1]!.id)
  })
  it('结构化修改保留ID，后台资源身份与类型隔离', () => {
    const first = ensurePlanEntityIds(historical)
    const changed = applyPlanEditOps(first, [{ target: 'spot', action: 'update', day: 0, index: 0, value: { name: '杭州西湖', id: 'attempted-change' } }])
    expect(changed.days[0]!.spots[0]!.id).toBe(first.days[0]!.spots[0]!.id)
    changed.foodJournal = [PlanSchema.parse({ title: '食记', foodJournal: [{ id: first.days[0]!.spots[0]!.id, name: '东坡肉' }] }).foodJournal[0]!]
    const entities = planEntities(changed)
    expect(new Set(entities.map(entity => entity.entityId)).size).toBe(entities.length)
    expect(entities.find(entity => entity.entityType === 'spot')?.fingerprint).not.toBe(planEntities(first).find(entity => entity.entityType === 'spot')?.fingerprint)
  })
  it('不通过可变下标继承身份；新增重名实体获得不同ID', () => {
    const next = ensurePlanEntityIds(PlanSchema.parse({ title: '杭州', days: [{ city: '杭州', spots: [{ name: '西湖' }, { name: '西湖' }] }] }))
    expect(next.days[0]!.spots[0]!.id).not.toBe(next.days[0]!.spots[1]!.id)
    expect(PlanSchema.safeParse({ ...next, days: [{ ...next.days[0], spots: [next.days[0]!.spots[0], next.days[0]!.spots[0]] }] }).success).toBe(false)
  })
})

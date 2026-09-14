import { describe, expect, it } from 'vitest'
import { applyMergePatch } from '#shared/utils/merge-patch'
import { PlanSchema } from '#shared/schemas/plan'

describe('applyMergePatch', () => {
  it('递归合并对象，null 删除字段', () => {
    const target = { title: 'a', days: [{ date: 'd1' }], budget: { total: 100, currency: 'CNY' } }
    const patch = { budget: { total: 200, currency: null }, tips: ['hi'] }
    expect(applyMergePatch(target, patch)).toMatchInlineSnapshot(`
      {
        "budget": {
          "total": 200,
        },
        "days": [
          {
            "date": "d1",
          },
        ],
        "tips": [
          "hi",
        ],
        "title": "a",
      }
    `)
  })

  it('数组整体替换', () => {
    const target = { tags: ['a', 'b'] }
    expect(applyMergePatch(target, { tags: ['c'] })).toEqual({ tags: ['c'] })
  })

  it('合并结果可通过 PlanSchema 校验', () => {
    const plan = PlanSchema.parse({ title: '杭州两日' })
    const patched = applyMergePatch(plan, {
      summary: '西湖漫步',
      days: [
        {
          date: '2026-10-01',
          city: '杭州',
          spots: [{ name: '断桥残雪', lng: 120.15, lat: 30.26, time: '09:00' }],
        },
      ],
      budget: { total: 1500, currency: 'CNY' },
    })
    const parsed = PlanSchema.parse(patched)
    expect(parsed.days[0]!.spots[0]!.name).toBe('断桥残雪')
    expect(parsed.budget.total).toBe(1500)
  })
})

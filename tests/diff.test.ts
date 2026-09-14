import { describe, expect, it } from 'vitest'
import { diffJson } from '#shared/utils/diff'

describe('diffJson', () => {
  it('对象递归 diff', () => {
    const before = { title: 'a', days: [{ city: '杭州' }], tips: ['x'] }
    const after = { title: 'b', days: [{ city: '苏州' }], tips: ['x'] }
    expect(diffJson(before, after)).toMatchInlineSnapshot(`
      [
        {
          "after": "b",
          "before": "a",
          "kind": "change",
          "path": "title",
        },
        {
          "after": "苏州",
          "before": "杭州",
          "kind": "change",
          "path": "days[0].city",
        },
      ]
    `)
  })

  it('数组长度变化记为整体替换', () => {
    expect(diffJson([1, 2], [1, 2, 3])).toMatchInlineSnapshot(`
      [
        {
          "after": [
            1,
            2,
            3,
          ],
          "before": [
            1,
            2,
          ],
          "kind": "change",
          "path": "$",
        },
      ]
    `)
  })

  it('无变化返回空数组', () => {
    expect(diffJson({ a: 1 }, { a: 1 })).toEqual([])
  })
})

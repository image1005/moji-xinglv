import { describe, expect, it } from 'vitest'
import { layoutVersionTree, type VersionTreeInput } from '../shared/utils/version-tree'

const node = (id: number, version: number, parentVersionId: number | null): VersionTreeInput => ({
  id,
  version,
  parentVersionId,
  source: 'user',
})

describe('版本路线图布局', () => {
  it('空列表返回空画布', () => {
    expect(layoutVersionTree([])).toEqual({ nodes: [], edges: [], width: 0, height: 0 })
  })

  it('线性追加逐层下降且同列对齐', () => {
    const { nodes, edges } = layoutVersionTree([node(3, 3, 2), node(1, 1, null), node(2, 2, 1)])
    expect(edges).toHaveLength(2)
    expect(nodes.map((item) => item.depth).sort()).toEqual([0, 1, 2])
    const x = new Set(nodes.map((item) => item.x))
    expect(x.size).toBe(1)
    expect(Math.max(...nodes.map((item) => item.y))).toBeGreaterThan(0)
  })

  it('切换后的新版本形成分叉且父节点居中', () => {
    const layout = layoutVersionTree([node(1, 1, null), node(2, 2, 1), node(3, 3, 1)])
    const [root, left, right] = [1, 2, 3].map((id) => layout.nodes.find((item) => item.id === id)!)
    expect(left.depth).toBe(1)
    expect(right.depth).toBe(1)
    expect(left.x).not.toBe(right.x)
    expect(root.x).toBeCloseTo((left.x + right.x) / 2)
    expect(layout.edges).toHaveLength(2)
  })

  it('父节点缺失时按根处理并保持父链分叉', () => {
    const layout = layoutVersionTree([node(1, 1, 99), node(2, 2, 1), node(3, 3, 1)])
    expect(layout.nodes).toHaveLength(3)
    expect(layout.nodes.find((item) => item.id === 1)!.depth).toBe(0)
    expect(layout.nodes.find((item) => item.id === 2)!.depth).toBe(1)
    expect(layout.edges).toHaveLength(2)
  })

  it('画布尺寸覆盖全部节点', () => {
    const layout = layoutVersionTree([node(1, 1, null), node(2, 2, 1), node(3, 3, 1)])
    for (const item of layout.nodes) {
      expect(item.x).toBeGreaterThanOrEqual(0)
      expect(item.x + item.width).toBeLessThanOrEqual(layout.width)
      expect(item.y + item.height).toBeLessThanOrEqual(layout.height)
    }
  })

  it('数千层历史无需递归调用栈且每条父边都保留', () => {
    const versions = Array.from({ length: 6000 }, (_, index) => node(index + 1, index + 1, index || null))
    const layout = layoutVersionTree(versions)
    expect(layout.nodes).toHaveLength(6000)
    expect(layout.edges).toHaveLength(5999)
    expect(layout.nodes.at(-1)?.depth).toBe(5999)
  })

  it('宽分叉的兄弟独立布局且深层边不会连接相邻兄弟', () => {
    const layout = layoutVersionTree([node(1, 1, null), ...Array.from({ length: 100 }, (_, index) => node(index + 2, index + 2, 1)), node(102, 102, 2)])
    const siblings = layout.nodes.filter(item => item.parentVersionId === 1).sort((a, b) => a.x - b.x)
    for (let index = 1; index < siblings.length; index += 1) expect(siblings[index]!.x).toBeGreaterThan(siblings[index - 1]!.x + siblings[index - 1]!.width)
    expect(layout.edges.find(edge => edge.to.id === 102)?.from.id).toBe(2)
    expect(layout.edges.filter(edge => edge.from.id === 1)).toHaveLength(100)
  })

  it('异常循环和独立历史仍各显示一次，且不产生自环连线', () => {
    const layout = layoutVersionTree([node(1, 1, null), node(2, 2, 3), node(3, 3, 2), node(4, 4, 4)])
    expect(layout.nodes.map(item => item.id).sort()).toEqual([1, 2, 3, 4])
    expect(layout.edges.every(edge => edge.from.id !== edge.to.id)).toBe(true)
  })
})

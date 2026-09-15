import type { PlanSource } from '../types'

/** 版本路线图布局：由 parent_version_id 生成多叉树（切换版本会在树上分叉）。 */
export interface VersionTreeInput {
  id: number
  version: number
  source: PlanSource
  parentVersionId: number | null
}

export interface VersionTreeNode extends VersionTreeInput {
  depth: number
  x: number
  y: number
  width: number
  height: number
}

export interface VersionTreeLayout {
  nodes: VersionTreeNode[]
  edges: { from: VersionTreeNode; to: VersionTreeNode }[]
  width: number
  height: number
}

const NODE_WIDTH = 64
const NODE_HEIGHT = 34

export function layoutVersionTree(
  versions: VersionTreeInput[],
  options: { xGap?: number; yGap?: number } = {},
): VersionTreeLayout {
  const stepX = NODE_WIDTH + (options.xGap ?? 34)
  const stepY = NODE_HEIGHT + (options.yGap ?? 30)
  if (!versions.length) return { nodes: [], edges: [], width: 0, height: 0 }

  const ordered = [...versions].sort((a, b) => a.version - b.version)
  const known = new Map(ordered.map((item) => [item.id, item]))
  const children = new Map<number | null, VersionTreeInput[]>()
  for (const item of ordered) {
    // 父节点缺失（历史脏数据）按根节点处理，不让整棵树断裂。
    const parent = item.parentVersionId !== null && known.has(item.parentVersionId) ? item.parentVersionId : null
    const list = children.get(parent) ?? []
    list.push(item)
    children.set(parent, list)
  }
  const roots = children.get(null) ?? (ordered[0] ? [ordered[0]] : [])

  const nodes = new Map<number, VersionTreeNode>()
  const edges: { from: VersionTreeNode; to: VersionTreeNode }[] = []
  let leafOrder = 0

  function place(source: VersionTreeInput, depth: number, visiting: Set<number>): VersionTreeNode {
    const node: VersionTreeNode = { ...source, depth, x: 0, y: depth * stepY, width: NODE_WIDTH, height: NODE_HEIGHT }
    nodes.set(source.id, node)
    const kids = (children.get(source.id) ?? []).filter((child) => !visiting.has(child.id))
    if (!kids.length) {
      node.x = leafOrder * stepX
      leafOrder += 1
      return node
    }
    visiting.add(source.id)
    const placed = kids.map((child) => place(child, depth + 1, visiting))
    visiting.delete(source.id)
    for (const child of placed) edges.push({ from: node, to: child })
    node.x = (placed[0]!.x + placed.at(-1)!.x) / 2
    return node
  }

  for (const root of roots) if (!nodes.has(root.id)) place(root, 0, new Set())

  const list = [...nodes.values()]
  const minX = Math.min(...list.map((node) => node.x))
  for (const node of list) node.x -= minX
  const width = Math.max(...list.map((node) => node.x)) + NODE_WIDTH
  const height = Math.max(...list.map((node) => node.y)) + NODE_HEIGHT
  return { nodes: list, edges, width, height }
}

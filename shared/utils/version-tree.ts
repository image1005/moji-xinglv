import type { PlanSource } from '../types'

/** 版本路线图布局：由 parent_version_id 生成多叉树（切换版本会在树上分叉）。 */
export interface VersionTreeInput {
  id: number
  version: number
  source: PlanSource
  parentVersionId: number | null
}

interface VersionTreeNode extends VersionTreeInput {
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

const NODE_WIDTH = 184
const NODE_HEIGHT = 78

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
  const roots = children.get(null) ?? []

  const nodes = new Map<number, VersionTreeNode>()
  const edges: { from: VersionTreeNode; to: VersionTreeNode }[] = []
  let leafOrder = 0

  function place(source: VersionTreeInput) {
    // Iterative post-order keeps long histories off the JS call stack. Visiting a
    // malformed cycle once also preserves disconnected records without looping.
    const stack: { source: VersionTreeInput; depth: number; entered: boolean; children: VersionTreeNode[]; parent?: { children: VersionTreeNode[] } }[] = [{ source, depth: 0, entered: false, children: [] }]
    while (stack.length) {
      const frame = stack.at(-1)!
      if (!frame.entered) {
        if (nodes.has(frame.source.id)) { stack.pop(); continue }
        const node: VersionTreeNode = { ...frame.source, depth: frame.depth, x: 0, y: frame.depth * stepY, width: NODE_WIDTH, height: NODE_HEIGHT }
        nodes.set(node.id, node)
        frame.entered = true
        frame.parent?.children.push(node)
        const kids = children.get(node.id) ?? []
        for (let index = kids.length - 1; index >= 0; index -= 1) {
          const child = kids[index]!
          if (!nodes.has(child.id)) stack.push({ source: child, depth: frame.depth + 1, entered: false, children: [], parent: frame })
        }
        continue
      }
      const node = nodes.get(frame.source.id)!
      if (frame.children.length) {
        node.x = (frame.children[0]!.x + frame.children.at(-1)!.x) / 2
        for (const child of frame.children) edges.push({ from: node, to: child })
      } else {
        node.x = leafOrder * stepX
        leafOrder += 1
      }
      stack.pop()
    }
  }

  for (const root of roots) if (!nodes.has(root.id)) place(root)
  for (const item of ordered) if (!nodes.has(item.id)) place(item)

  const list = [...nodes.values()]
  const minX = list.reduce((min, node) => Math.min(min, node.x), Infinity)
  for (const node of list) node.x -= minX
  const width = list.reduce((max, node) => Math.max(max, node.x), 0) + NODE_WIDTH
  const height = list.reduce((max, node) => Math.max(max, node.y), 0) + NODE_HEIGHT
  return { nodes: list, edges, width, height }
}

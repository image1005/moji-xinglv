export interface DiffEntry {
  path: string
  before?: unknown
  after?: unknown
  kind: 'add' | 'remove' | 'change'
}

/** 结构化 JSON diff（用于 plan_versions.diff_json 与快照测试） */
export function diffJson(before: unknown, after: unknown, basePath = ''): DiffEntry[] {
  if (Object.is(before, after)) return []
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) return [{ path: basePath || '$', before, after, kind: 'change' }]
    return before.flatMap((item, i) => diffJson(item, after[i], `${basePath}[${i}]`))
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const entries: DiffEntry[] = []
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const key of keys) {
      const path = basePath ? `${basePath}.${key}` : key
      const hasBefore = key in before
      const hasAfter = key in after
      if (hasBefore && !hasAfter) entries.push({ path, before: before[key], kind: 'remove' })
      else if (!hasBefore && hasAfter) entries.push({ path, after: after[key], kind: 'add' })
      else entries.push(...diffJson(before[key], after[key], path))
    }
    return entries
  }
  return [{ path: basePath || '$', before, after, kind: 'change' }]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

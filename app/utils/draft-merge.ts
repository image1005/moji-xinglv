export interface DraftDifference { label: string; current: string; draft: string }

export function isDraftForm<T extends Record<string, unknown>>(value: unknown, template: T): value is T {
  return !!value && typeof value === 'object' && Object.entries(template).every(([key, field]) => typeof (value as Record<string, unknown>)[key] === typeof field)
}

function display(value: unknown): string {
  if (value === '' || value === null || value === undefined) return '（留空）'
  if (Array.isArray(value)) return value.map(display).join('、') || '（留空）'
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}：${display(item)}`).join('；')
  return String(value)
}

/** Only locally changed fields are reapplied; unrelated remote edits remain intact. */
export function mergeDraftFields<T extends Record<string, unknown>>(base: T, draft: T, latest: T, labels: Partial<Record<keyof T, string>> = {}) {
  const merged = { ...latest }
  const differences: DraftDifference[] = []
  for (const key of Object.keys(draft) as (keyof T)[]) {
    if (JSON.stringify(base[key]) === JSON.stringify(draft[key])) continue
    merged[key] = draft[key]
    if (JSON.stringify(latest[key]) !== JSON.stringify(draft[key])) differences.push({ label: labels[key] ?? String(key), current: display(latest[key]), draft: display(draft[key]) })
  }
  return { merged, differences }
}

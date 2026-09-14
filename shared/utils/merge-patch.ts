/**
 * JSON Merge Patch（RFC 7396）：对象递归合并，数组整体替换，null 删除字段。
 * AI 只允许产出 patch，服务端应用后再经 PlanSchema 校验（PRD §3.3）。
 */
export function applyMergePatch<T>(target: T, patch: unknown): T {
  if (!isPlainObject(patch)) return patch as T
  const base: Record<string, unknown> = isPlainObject(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      Reflect.deleteProperty(base, key)
      continue
    }
    base[key] = applyMergePatch(base[key], value)
  }
  return base as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

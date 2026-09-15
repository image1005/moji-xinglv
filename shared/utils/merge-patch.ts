/** RFC 7396：对象递归合并、数组替换、null 删除。输入均视为不可信数据。 */
export function applyMergePatch<T>(target: T, patch: unknown): T {
  let nodes = 0
  function validate(value: unknown, depth = 0): void {
    if (++nodes > 30000 || depth > 40) throw new Error('patch 超过复杂度限制')
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('patch 包含禁止的对象属性')
        validate(child, depth + 1)
      }
    }
  }
  validate(patch)
  function merge(current: unknown, change: unknown): unknown {
    if (!isPlainObject(change)) return structuredClone(change)
    const base: Record<string, unknown> = isPlainObject(current) ? { ...current } : {}
    for (const [key, value] of Object.entries(change)) {
      if (value === null) Reflect.deleteProperty(base, key)
      else base[key] = merge(Object.hasOwn(base, key) ? base[key] : undefined, value)
    }
    return base
  }
  return merge(target, patch) as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

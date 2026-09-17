const PREFIX = 'shanhai:draft:v1:'
const MAX_AGE = 30 * 24 * 3600 * 1000

export function draftKey(userId: string, planId: number | null, object: string) {
  return `${PREFIX}${encodeURIComponent(userId)}:${planId ?? 'global'}:${encodeURIComponent(object)}`
}

export function readDraft<T>(storage: Pick<Storage, 'getItem' | 'removeItem'>, key: string, validate: (value: unknown) => T | null): T | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw) as { savedAt?: number; data?: unknown }
    if (typeof entry.savedAt !== 'number' || Date.now() - entry.savedAt > MAX_AGE) {
      storage.removeItem(key)
      return null
    }
    return validate(entry.data)
  } catch { return null }
}

export function writeDraft(storage: Pick<Storage, 'setItem'>, key: string, data: unknown) {
  storage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }))
}

/**
 * 前端 IndexedDB 缓存（PRD §3.10）：街景 Blob 与 JSON，TTL + LRU。
 * 仅客户端可用；SSR 下请放在 onMounted / watchEffect 中调用。
 */

const DB_NAME = 'guofeng-travel'
const STORE = 'kv'
const MAX_ENTRIES = 300

interface IdbEntry<T = unknown> {
  key: string
  payload: T
  expiresAt: number
  lastAccess: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const request = run(transaction.objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }),
  )
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const entry = await tx<IdbEntry<T> | undefined>('readonly', (store) => store.get(key))
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    await tx('readwrite', (store) => store.delete(key))
    return null
  }
  entry.lastAccess = Date.now()
  await tx('readwrite', (store) => store.put(entry))
  return entry.payload
}

export async function idbSet<T>(key: string, payload: T, ttlSeconds: number): Promise<void> {
  const entry: IdbEntry<T> = {
    key,
    payload,
    expiresAt: Date.now() + ttlSeconds * 1000,
    lastAccess: Date.now(),
  }
  await tx('readwrite', (store) => store.put(entry))
  void prune()
}

async function prune(): Promise<void> {
  const keys = await tx<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
  if (keys.length <= MAX_ENTRIES) return
  const entries = await tx<IdbEntry[]>('readonly', (store) => store.getAll())
  entries
    .sort((a, b) => a.lastAccess - b.lastAccess)
    .slice(0, entries.length - MAX_ENTRIES)
    .forEach((entry) => void tx('readwrite', (store) => store.delete(entry.key)))
}

/** 带 IndexedDB 缓存的图片请求：命中直接返回 Blob，未命中请求后写回 */
export async function fetchBlobCached(url: string, ttlSeconds = 7 * 24 * 3600): Promise<Blob> {
  const key = `blob:${url}`
  const cached = await idbGet<Blob>(key)
  if (cached) return cached
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`加载失败：${response.status}`)
  const blob = await response.blob()
  await idbSet(key, blob, ttlSeconds)
  return blob
}

/** 带 IndexedDB 缓存的 JSON 请求 */
export async function fetchJsonCached<T>(url: string, ttlSeconds = 3600): Promise<T> {
  const key = `json:${url}`
  const cached = await idbGet<T>(key)
  if (cached) return cached
  const data = (await $fetch(url)) as T
  await idbSet(key, data, ttlSeconds)
  return data
}

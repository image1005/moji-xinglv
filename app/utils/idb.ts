/** 客户端用户隔离缓存；IndexedDB 不可用时退化为普通请求。 */
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
let cacheUser: string | null = null
let cacheGeneration = 0
let cacheReady: Promise<void> = Promise.resolve()

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('浏览器缓存不可用'))
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    let failed = false
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => {
      const db = request.result
      if (failed) {
        db.close()
        return
      }
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    request.onerror = () => {
      failed = true
      reject(request.error)
    }
    request.onblocked = () => {
      failed = true
      reject(new Error('浏览器缓存被其他页面占用'))
    }
  }).catch((error: unknown) => {
    dbPromise = null
    throw error
  })
  return dbPromise
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>, generation?: number): Promise<T> {
  const db = await openDb()
  if (generation !== undefined && generation !== cacheGeneration) throw new Error('缓存身份已变化')
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const request = run(transaction.objectStore(STORE))
    transaction.oncomplete = () => resolve(request.result)
    transaction.onerror = () => reject(transaction.error ?? request.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('浏览器缓存事务已中止'))
  })
}

/** 身份变化立即使旧请求失效，并清理旧用户及历史无作用域缓存。 */
export function setCacheUser(userId: string | null): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (userId === cacheUser && cacheGeneration > 0) return cacheReady
  cacheUser = userId
  cacheGeneration++
  cacheReady = cacheReady.catch(() => {}).then(async () => {
    try {
      if (!userId) {
        await tx('readwrite', (store) => store.clear())
      } else {
        const prefix = `${encodeURIComponent(userId)}:`
        const keys = await tx<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
        await Promise.all(keys.filter((key) => typeof key !== 'string' || !key.startsWith(prefix))
          .map((key) => tx('readwrite', (store) => store.delete(key))))
      }
    } catch {
      // 不允许存储时仍可退出并直接请求资源。
    }
  })
  return cacheReady
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const generation = cacheGeneration
  const user = cacheUser
  if (!user) return null
  await cacheReady
  if (generation !== cacheGeneration) return null
  const scopedKey = `${encodeURIComponent(user)}:${key}`
  const entry = await tx<IdbEntry<T> | undefined>('readonly', (store) => store.get(scopedKey))
  if (!entry || generation !== cacheGeneration) return null
  if (entry.expiresAt <= Date.now()) {
    await tx('readwrite', (store) => store.delete(scopedKey), generation)
    return null
  }
  entry.lastAccess = Date.now()
  await tx('readwrite', (store) => store.put(entry), generation)
  return generation === cacheGeneration ? entry.payload : null
}

export async function idbSet<T>(key: string, payload: T, ttlSeconds: number): Promise<void> {
  const generation = cacheGeneration
  const user = cacheUser
  if (!user) return
  await cacheReady
  if (generation !== cacheGeneration) return
  const entry: IdbEntry<T> = {
    key: `${encodeURIComponent(user)}:${key}`,
    payload,
    expiresAt: Date.now() + ttlSeconds * 1000,
    lastAccess: Date.now(),
  }
  await tx('readwrite', (store) => store.put(entry), generation)
  if (generation === cacheGeneration) await prune(generation)
}

async function prune(generation: number): Promise<void> {
  const entries = await tx<IdbEntry[]>('readonly', (store) => store.getAll())
  if (generation !== cacheGeneration) return
  const ordered = entries.sort((a, b) => a.lastAccess - b.lastAccess)
  const excess = Math.max(0, ordered.length - MAX_ENTRIES)
  await Promise.all(ordered.filter((entry, index) => index < excess || entry.expiresAt <= Date.now())
    .map((entry) => tx('readwrite', (store) => store.delete(entry.key), generation)))
}

export async function fetchBlobCached(url: string, ttlSeconds = 7 * 24 * 3600, signal?: AbortSignal): Promise<Blob> {
  const generation = cacheGeneration
  const key = `blob:${url}`
  signal?.throwIfAborted()
  const cached = await idbGet<Blob>(key).catch(() => null)
  signal?.throwIfAborted()
  if (generation !== cacheGeneration) throw new Error('登录状态已变化，请重新加载图片')
  if (cached instanceof Blob) return cached
  const response = await fetch(url, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(`加载失败：${response.status}`)
  const blob = await response.blob()
  signal?.throwIfAborted()
  if (generation !== cacheGeneration) throw new Error('登录状态已变化，请重新加载图片')
  await idbSet(key, blob, ttlSeconds).catch(() => {})
  signal?.throwIfAborted()
  if (generation !== cacheGeneration) throw new Error('登录状态已变化，请重新加载图片')
  return blob
}

export async function fetchJsonCached<T>(url: string, ttlSeconds = 3600): Promise<T> {
  const generation = cacheGeneration
  const key = `json:${url}`
  const cached = await idbGet<T>(key).catch(() => null)
  if (generation !== cacheGeneration) throw new Error('登录状态已变化，请重新加载数据')
  if (cached !== null) return cached
  const data = await $fetch(url) as T
  if (generation !== cacheGeneration) throw new Error('登录状态已变化，请重新加载数据')
  await idbSet(key, data, ttlSeconds).catch(() => {})
  if (generation !== cacheGeneration) throw new Error('登录状态已变化，请重新加载数据')
  return data
}

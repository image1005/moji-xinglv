/** User-scoped cache. Metadata lives separately so eviction never reads image blobs. */
const DB_NAME = 'guofeng-travel'
const STORE = 'kv'
const META = 'metadata'
const CACHE_MAX_BYTES = 48 * 1024 * 1024
const MAX_ENTRIES = 300
interface CacheMeta { key: string; expiresAt: number; lastAccess: number; bytes: number }
let dbPromise: Promise<IDBDatabase> | null = null
let cacheUser: string | null = null
let cacheGeneration = 0
let cacheReady: Promise<void> = Promise.resolve()

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('浏览器缓存不可用'))
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    let failed = false
    request.onupgradeneeded = () => {
      const db = request.result
      // Old cache is disposable; rebuilding avoids decoding every legacy blob on upgrade.
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE)
      db.createObjectStore(STORE, { keyPath: 'key' })
      if (db.objectStoreNames.contains(META)) db.deleteObjectStore(META)
      const metadata = db.createObjectStore(META, { keyPath: 'key' })
      metadata.createIndex('lastAccess', 'lastAccess')
    }
    request.onsuccess = () => {
      const db = request.result
      if (failed) { db.close(); return }
      db.onversionchange = () => { db.close(); dbPromise = null }
      resolve(db)
    }
    request.onerror = () => { failed = true; reject(request.error) }
    request.onblocked = () => { failed = true; reject(new Error('浏览器缓存被其他页面占用')) }
  }).catch((error: unknown) => { dbPromise = null; throw error })
  return dbPromise
}

async function transaction<T>(run: (data: IDBObjectStore, meta: IDBObjectStore, done: (value: T) => void) => void, generation?: number): Promise<T> {
  const db = await openDb()
  if (generation !== undefined && generation !== cacheGeneration) throw new Error('缓存身份已变化')
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction([STORE, META], 'readwrite')
    let value: T
    tx.oncomplete = () => resolve(value)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('浏览器缓存事务已中止'))
    run(tx.objectStore(STORE), tx.objectStore(META), (result) => { value = result })
  })
}

/** @internal Exported only for deterministic capacity/TTL policy tests; idbSet owns production use. */
export function selectCacheEvictions(entries: CacheMeta[], now = Date.now(), maxBytes = CACHE_MAX_BYTES, maxEntries = MAX_ENTRIES): string[] {
  const ordered = [...entries].sort((a, b) => a.lastAccess - b.lastAccess)
  let bytes = ordered.reduce((total, entry) => total + entry.bytes, 0)
  let count = ordered.length
  const removed = new Set<string>()
  for (const entry of ordered) {
    if (entry.expiresAt <= now) { removed.add(entry.key); bytes -= entry.bytes; count-- }
  }
  for (const entry of ordered) {
    if (bytes <= maxBytes && count <= maxEntries) break
    if (removed.has(entry.key)) continue
    removed.add(entry.key)
    bytes -= entry.bytes
    count--
  }
  return [...removed]
}

export function setCacheUser(userId: string | null): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (userId === cacheUser && cacheGeneration > 0) return cacheReady
  cacheUser = userId
  cacheGeneration++
  for (const job of blobRequests.values()) job.controller.abort()
  blobRequests.clear()
  cacheReady = cacheReady.catch(() => {}).then(async () => {
    try {
      await transaction<null>((data, meta, done) => {
        if (!userId) { data.clear(); meta.clear(); done(null); return }
        const prefix = `${encodeURIComponent(userId)}:`
        const request = meta.openKeyCursor()
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) { done(null); return }
          if (typeof cursor.key !== 'string' || !cursor.key.startsWith(prefix)) { data.delete(cursor.key); meta.delete(cursor.key) }
          cursor.continue()
        }
      })
    } catch { /* Private browsing still permits direct requests. */ }
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
  const result = await transaction<T | null>((data, meta, done) => {
    const request = meta.get(scopedKey)
    request.onsuccess = () => {
      const entry = request.result as CacheMeta | undefined
      if (!entry || entry.expiresAt <= Date.now()) { data.delete(scopedKey); meta.delete(scopedKey); done(null); return }
      meta.put({ ...entry, lastAccess: Date.now() })
      const payload = data.get(scopedKey)
      payload.onsuccess = () => done((payload.result as { payload: T } | undefined)?.payload ?? null)
    }
  }, generation)
  return generation === cacheGeneration ? result : null
}

export async function idbSet<T>(key: string, payload: T, ttlSeconds: number): Promise<void> {
  const generation = cacheGeneration
  const user = cacheUser
  if (!user) return
  const bytes = payload instanceof Blob ? payload.size : new TextEncoder().encode(JSON.stringify(payload)).byteLength
  if (bytes > CACHE_MAX_BYTES) return
  await cacheReady
  if (generation !== cacheGeneration) return
  const scopedKey = `${encodeURIComponent(user)}:${key}`
  await transaction<null>((data, meta, done) => {
    data.put({ key: scopedKey, payload })
    meta.put({ key: scopedKey, bytes, expiresAt: Date.now() + ttlSeconds * 1000, lastAccess: Date.now() } satisfies CacheMeta)
    const entries: CacheMeta[] = []
    const request = meta.index('lastAccess').openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) { entries.push(cursor.value as CacheMeta); cursor.continue(); return }
      for (const expired of selectCacheEvictions(entries)) { data.delete(expired); meta.delete(expired) }
      done(null)
    }
  }, generation)
}

interface BlobRequest { controller: AbortController; promise: Promise<Blob>; subscribers: number; settled: boolean }
const blobRequests = new Map<string, BlobRequest>()

async function removeBlob(url: string, generation: number) {
  const user = cacheUser
  if (!user) return
  await cacheReady
  const key = `${encodeURIComponent(user)}:blob:${url}`
  await transaction<null>((data, meta, done) => { data.delete(key); meta.delete(key); done(null) }, generation)
}

function isImage(blob: Blob) {
  return blob.size > 0 && blob.size <= 8 * 1024 * 1024 && ['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)
}

async function loadBlob(url: string, ttlSeconds: number, signal: AbortSignal, generation: number, refresh: boolean): Promise<Blob> {
  try {
    signal.throwIfAborted()
    if (refresh) await removeBlob(url, generation).catch(() => {})
    const cached = refresh ? null : await idbGet<Blob>(`blob:${url}`).catch(() => null)
    if (generation !== cacheGeneration) throw new Error('登录状态已变化，请重新加载图片')
    signal.throwIfAborted()
    if (cached instanceof Blob && isImage(cached)) return cached
    const response = await fetch(url, { credentials: 'same-origin', signal, ...(refresh ? { cache: 'reload' as const } : {}) })
    if (!response.ok) throw new Error(`加载失败：${response.status}`)
    const blob = await response.blob()
    if (!isImage(blob)) throw new Error('图片格式或大小不受支持')
    // A 200 response can still contain an HTML error or corrupt image. Never persist it.
    if (typeof createImageBitmap === 'function') { const decoded = await createImageBitmap(blob); decoded.close() }
    if (generation !== cacheGeneration) throw new Error('登录状态已变化，请重新加载图片')
    signal.throwIfAborted()
    await idbSet(`blob:${url}`, blob, ttlSeconds).catch(() => {})
    if (generation !== cacheGeneration) throw new Error('登录状态已变化，请重新加载图片')
    signal.throwIfAborted()
    return blob
  } catch (error) {
    if (generation !== cacheGeneration) throw new Error('登录状态已变化，请重新加载图片', { cause: error })
    throw error
  }
}

/** Cancelling one subscriber never cancels another; the last cancellation stops the fetch. */
export function fetchBlobCached(url: string, ttlSeconds = 7 * 24 * 3600, signal?: AbortSignal, refresh = false): Promise<Blob> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('已取消', 'AbortError'))
  const key = `${cacheGeneration}:${refresh ? 'reload' : 'cached'}:${url}`
  let job = blobRequests.get(key)
  if (!job) {
    const controller = new AbortController()
    job = { controller, promise: Promise.resolve(new Blob()), subscribers: 0, settled: false }
    const owned = job
    job.promise = loadBlob(url, ttlSeconds, controller.signal, cacheGeneration, refresh).finally(() => {
      owned.settled = true
      if (blobRequests.get(key) === owned) blobRequests.delete(key)
    })
    blobRequests.set(key, job)
  }
  const shared = job
  shared.subscribers++
  return new Promise<Blob>((resolve, reject) => {
    let finished = false
    function release() {
      if (finished) return false
      finished = true
      signal?.removeEventListener('abort', abort)
      shared.subscribers--
      if (!shared.subscribers && !shared.settled) {
        shared.controller.abort()
        if (blobRequests.get(key) === shared) blobRequests.delete(key)
      }
      return true
    }
    function abort() { if (release()) reject(signal?.reason ?? new DOMException('已取消', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    shared.promise.then((blob) => { if (release()) resolve(blob) }, (error: unknown) => { if (release()) reject(error) })
  })
}

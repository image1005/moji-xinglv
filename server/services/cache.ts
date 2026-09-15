import { eq, sql } from 'drizzle-orm'
import { cache } from '../database/schema'
import { db } from '../utils/db'

/**
 * 后端缓存：Nitro storage（L1，本地/内存） → SQLite cache 表（L2，持久化）。
 * key = hash(api + params)，校验 expires_at（PRD §3.10）。
 */

const storage = () => useStorage('cache')

interface StoredJson<T> {
  v: T
  e: number
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
  const l1 = await storage().getItem<StoredJson<T>>(`json:${key}`)
  if (l1 && l1.e > Date.now()) return l1.v

  const row = await db.select().from(cache).where(eq(cache.key, `json:${key}`)).get()
  if (row && row.expiresAt.getTime() > Date.now()) {
    const value = JSON.parse(Buffer.from(row.value).toString('utf8')) as T
    await storage().setItem(`json:${key}`, { v: value, e: row.expiresAt.getTime() } satisfies StoredJson<T>)
    return value
  }
  return null
}

export async function setCachedJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  const text = JSON.stringify(value)
  await storage().setItem(`json:${key}`, { v: value, e: expiresAt.getTime() } satisfies StoredJson<unknown>, {
    ttl: ttlSeconds,
  })
  await db
    .insert(cache)
    .values({ key: `json:${key}`, value: Buffer.from(text, 'utf8'), type: 'json', expiresAt })
    .onConflictDoUpdate({
      target: cache.key,
      set: { value: Buffer.from(text, 'utf8'), expiresAt, type: 'json' },
    })
}

export async function getCachedBinary(key: string): Promise<Buffer | null> {
  const cacheKey = `bin:${key}`
  const l1 = await storage().getItem<StoredJson<string>>(cacheKey)
  if (l1 && l1.e > Date.now()) return Buffer.from(l1.v, 'base64')
  const row = await db.select().from(cache).where(eq(cache.key, cacheKey)).get()
  if (row && row.expiresAt.getTime() > Date.now()) {
    const value = Buffer.from(row.value)
    const expiresAt = row.expiresAt.getTime()
    await storage().setItem(cacheKey, { v: value.toString('base64'), e: expiresAt } satisfies StoredJson<string>, {
      ttl: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
    })
    return value
  }
  return null
}

export async function setCachedBinary(key: string, buffer: Buffer, ttlSeconds: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  await db
    .insert(cache)
    .values({ key: `bin:${key}`, value: buffer, type: 'image', expiresAt })
    .onConflictDoUpdate({ target: cache.key, set: { value: buffer, expiresAt, type: 'image' } })
  await storage().setItem(`bin:${key}`, {
    v: buffer.toString('base64'), e: expiresAt.getTime(),
  } satisfies StoredJson<string>, { ttl: ttlSeconds })
}

export async function clearCache(prefix?: string): Promise<number> {
  // 使用字面前缀，避免 LIKE 将 % 和 _ 当作通配符扩大删除范围。
  const where = prefix === undefined ? undefined : sql`substr(${cache.key}, 1, length(${prefix})) = ${prefix}`
  const rows = db.delete(cache).where(where).returning({ key: cache.key }).all()
  const l1 = storage()
  if (prefix === undefined) {
    await l1.clear()
  } else {
    const keys = await l1.getKeys()
    await Promise.all(keys.filter((key) => key.startsWith(prefix)).map((key) => l1.removeItem(key)))
  }
  return rows.length
}

export async function cacheStats() {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      expired: sql<number>`sum(case when expires_at <= ${Date.now()} then 1 else 0 end)`,
      bytes: sql<number>`coalesce(sum(length(value)), 0)`,
    })
    .from(cache)
  return { total: Number(row?.total ?? 0), expired: Number(row?.expired ?? 0), bytes: Number(row?.bytes ?? 0) }
}

import { eq, like, sql } from 'drizzle-orm'
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
  const row = await db.select().from(cache).where(eq(cache.key, `bin:${key}`)).get()
  if (row && row.expiresAt.getTime() > Date.now()) return Buffer.from(row.value)
  return null
}

export async function setCachedBinary(key: string, buffer: Buffer, ttlSeconds: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  await db
    .insert(cache)
    .values({ key: `bin:${key}`, value: buffer, type: 'image', expiresAt })
    .onConflictDoUpdate({ target: cache.key, set: { value: buffer, expiresAt, type: 'image' } })
}

export async function clearCache(prefix?: string): Promise<number> {
  const where = prefix ? like(cache.key, `${prefix}%`) : undefined
  const rows = where ? await db.delete(cache).where(where).returning({ key: cache.key }) : await db.delete(cache).returning({ key: cache.key })
  try {
    await storage().clear()
  } catch {
    // 忽略 storage 清理失败
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

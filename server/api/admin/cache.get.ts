import { desc, sql } from 'drizzle-orm'
import { cache } from '../../database/schema'
import { cacheStats } from '../../services/cache'
import { db } from '../../utils/db'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const stats = await cacheStats()
  const rows = await db
    .select({
      key: cache.key,
      type: cache.type,
      expiresAt: cache.expiresAt,
      size: sql<number>`length(${cache.value})`,
      createdAt: cache.createdAt,
    })
    .from(cache)
    .orderBy(desc(cache.createdAt))
    .limit(50)
  return {
    stats,
    entries: rows.map((r) => ({
      key: r.key,
      type: r.type,
      size: Number(r.size),
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      expired: r.expiresAt.getTime() <= Date.now(),
    })),
  }
})

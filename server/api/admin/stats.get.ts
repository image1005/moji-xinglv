import { count } from 'drizzle-orm'
import { cache, conversations, messages, panoramas, plans } from '../../database/schema'
import { cacheStats } from '../../services/cache'
import { db } from '../../utils/db'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const [planCount] = await db.select({ c: count() }).from(plans)
  const [conversationCount] = await db.select({ c: count() }).from(conversations)
  const [messageCount] = await db.select({ c: count() }).from(messages)
  const [panoramaCount] = await db.select({ c: count() }).from(panoramas)
  const byType = await db
    .select({ type: cache.type, c: count() })
    .from(cache)
    .groupBy(cache.type)
  const stats = await cacheStats()
  const cacheByType = Object.fromEntries(byType.map((r) => [r.type, Number(r.c)]))
  return {
    plans: Number(planCount?.c ?? 0),
    conversations: Number(conversationCount?.c ?? 0),
    messages: Number(messageCount?.c ?? 0),
    cache: stats,
    baidu: {
      panoramaImages: Number(panoramaCount?.c ?? 0),
      staticMaps: cacheByType.image ?? 0,
      poiQueries: cacheByType.json ?? 0,
    },
  }
})

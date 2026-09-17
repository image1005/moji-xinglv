import { count, desc } from 'drizzle-orm'
import { conversations, messages, plans } from '../../database/schema'
import { chatRuns } from '../../database/operations'
import { cacheStats } from '../../services/cache'
import { metricTotals } from '../../services/metrics'
import { publicRun } from '../../services/chat-runs'
import { db } from '../../utils/db'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const [planCount] = await db.select({ c: count() }).from(plans)
  const [conversationCount] = await db.select({ c: count() }).from(conversations)
  const [messageCount] = await db.select({ c: count() }).from(messages)
  const stats = await cacheStats()
  const runs = db.select({ status: chatRuns.status, count: count() }).from(chatRuns).groupBy(chatRuns.status).all()
  return {
    plans: Number(planCount?.c ?? 0),
    conversations: Number(conversationCount?.c ?? 0),
    messages: Number(messageCount?.c ?? 0),
    cache: stats,
    metrics: metricTotals(),
    runs,
    recentRuns: db.select().from(chatRuns).orderBy(desc(chatRuns.id)).limit(20).all().map(publicRun),
  }
})

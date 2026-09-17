import { eq, sql } from 'drizzle-orm'
import { usageMetrics } from '../database/operations'
import { db } from '../utils/db'

export interface MetricEvent {
  service: 'ai' | 'staticmap' | 'panorama'
  userId?: string
  outcome: 'success' | 'error' | 'cache_hit'
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  steps?: number
}

/** One bounded aggregate row per UTC day, user and service; no prompts, URLs or secrets. */
export function recordMetric(event: MetricEvent) {
  const whole = (value?: number) => Number.isFinite(value) ? Math.max(0, Math.round(value!)) : 0
  const values = {
    day: new Date().toISOString().slice(0, 10), userId: event.userId ?? '', service: event.service,
    requests: event.outcome === 'cache_hit' ? 0 : 1, errors: event.outcome === 'error' ? 1 : 0,
    cacheHits: event.outcome === 'cache_hit' ? 1 : 0, durationMs: whole(event.durationMs),
    inputTokens: whole(event.inputTokens), outputTokens: whole(event.outputTokens),
    usageSamples: Number.isFinite(event.inputTokens) && Number.isFinite(event.outputTokens) ? 1 : 0,
    steps: whole(event.steps),
  }
  db.insert(usageMetrics).values(values).onConflictDoUpdate({
    target: [usageMetrics.day, usageMetrics.userId, usageMetrics.service],
    set: {
      requests: sql`${usageMetrics.requests} + ${values.requests}`, errors: sql`${usageMetrics.errors} + ${values.errors}`,
      cacheHits: sql`${usageMetrics.cacheHits} + ${values.cacheHits}`, durationMs: sql`${usageMetrics.durationMs} + ${values.durationMs}`,
      inputTokens: sql`${usageMetrics.inputTokens} + ${values.inputTokens}`, outputTokens: sql`${usageMetrics.outputTokens} + ${values.outputTokens}`,
      usageSamples: sql`${usageMetrics.usageSamples} + ${values.usageSamples}`, steps: sql`${usageMetrics.steps} + ${values.steps}`,
    },
  }).run()
}

export function metricTotals(userId?: string) {
  return db.select({
    service: usageMetrics.service, requests: sql<number>`sum(${usageMetrics.requests})`, errors: sql<number>`sum(${usageMetrics.errors})`,
    cacheHits: sql<number>`sum(${usageMetrics.cacheHits})`, durationMs: sql<number>`sum(${usageMetrics.durationMs})`,
    inputTokens: sql<number>`sum(${usageMetrics.inputTokens})`, outputTokens: sql<number>`sum(${usageMetrics.outputTokens})`,
    usageSamples: sql<number>`sum(${usageMetrics.usageSamples})`, steps: sql<number>`sum(${usageMetrics.steps})`,
  }).from(usageMetrics).where(userId === undefined ? undefined : eq(usageMetrics.userId, userId)).groupBy(usageMetrics.service).all()
}

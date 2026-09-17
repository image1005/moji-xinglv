import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema'

/** Durable request identity and checkpoints. Content remains in messages, never in telemetry. */
export const chatRuns = sqliteTable('chat_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  requestId: text('request_id').notNull(),
  requestHash: text('request_hash').notNull(),
  planId: integer('plan_id').notNull(),
  conversationId: integer('conversation_id').notNull(),
  assistantMessageId: integer('assistant_message_id'),
  status: text('status', { enum: ['queued', 'running', 'completed', 'cancelled', 'failed', 'interrupted'] }).notNull(),
  steps: integer('steps').notNull().default(0),
  errorCode: text('error_code'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
}, t => [uniqueIndex('chat_runs_user_request_uq').on(t.userId, t.requestId), index('chat_runs_status_idx').on(t.status), index('chat_runs_user_started_idx').on(t.userId, t.startedAt), index('chat_runs_started_idx').on(t.startedAt), index('chat_runs_conversation_idx').on(t.conversationId, t.id)])

export const usageMetrics = sqliteTable('usage_metrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  day: text('day').notNull(),
  userId: text('user_id').notNull().default(''),
  service: text('service').notNull(),
  requests: integer('requests').notNull().default(0),
  errors: integer('errors').notNull().default(0),
  cacheHits: integer('cache_hits').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  usageSamples: integer('usage_samples').notNull().default(0),
  steps: integer('steps').notNull().default(0),
}, t => [uniqueIndex('usage_metrics_day_user_service_uq').on(t.day, t.userId, t.service)])

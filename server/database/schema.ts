/**
 * 全部 Drizzle 表定义（PRD §4）。
 * 注意：user/session/account/verification 由 Better Auth CLI 生成（auth-schema.ts），
 * 不要手改；改鉴权配置后重新运行 `bunx --bun @better-auth/cli generate`。
 */
import { blob, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema'

export * from './auth-schema'

const now = () => new Date()

export const plans = sqliteTable(
  'plans',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    contentMd: text('content_md').notNull().default(''),
    planJson: text('plan_json', { mode: 'json' }).notNull(),
    coverUrl: text('cover_url').notNull().default(''),
    /** 当前版本指针（plan_versions.id）；切换历史版本只改指针，不新建版本。 */
    currentVersionId: integer('current_version_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(now)
      .$onUpdate(now),
  },
  (t) => [index('plans_user_updated_idx').on(t.userId, t.updatedAt)],
)

export const planVersions = sqliteTable(
  'plan_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    planId: integer('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    planJson: text('plan_json', { mode: 'json' }).notNull(),
    createdBy: text('created_by'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    parentVersionId: integer('parent_version_id'),
    source: text('source').notNull().default('ai'),
    diffJson: text('diff_json', { mode: 'json' }),
    messageId: integer('message_id'),
  },
  (t) => [uniqueIndex('plan_versions_plan_version_uq').on(t.planId, t.version)],
)

export const panoramas = sqliteTable(
  'panoramas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    location: text('location').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    imageBlob: blob('image_blob', { mode: 'buffer' }).notNull(),
    hash: text('hash').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
  },
  (t) => [index('panoramas_location_idx').on(t.location)],
)

export const cache = sqliteTable('cache', {
  key: text('key').primaryKey(),
  value: blob('value', { mode: 'buffer' }).notNull(),
  type: text('type').notNull().default('json'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
})

export const conversations = sqliteTable(
  'conversations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    planId: integer('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('新对话'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(now)
      .$onUpdate(now),
  },
  (t) => [index('conversations_plan_idx').on(t.planId, t.updatedAt)],
)

export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    conversationId: integer('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull().default(''),
    toolCalls: text('tool_calls', { mode: 'json' }),
    previewJson: text('preview_json', { mode: 'json' }),
    planVersionId: integer('plan_version_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
)

export const agentsMd = sqliteTable(
  'agents_md',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    planId: integer('plan_id').references(() => plans.id, { onDelete: 'cascade' }),
    content: text('content').notNull().default(''),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(now)
      .$onUpdate(now),
  },
  (t) => [uniqueIndex('agents_md_user_plan_uq').on(t.userId, t.planId)],
)

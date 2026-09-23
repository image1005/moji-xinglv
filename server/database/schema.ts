/**
 * 全部 Drizzle 表定义（PRD §4）。
 * 注意：user/session/account/verification 由 Better Auth CLI 生成（auth-schema.ts），
 * 不要手改；改鉴权配置后重新运行 `bunx --bun @better-auth/cli generate`。
 */
import { blob, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from './auth-schema'

export * from './auth-schema'
export * from './operations'

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
    /** 内容或当前指针每次变化递增；与可复用的展示版本号分开。 */
    revision: integer('revision').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(now)
      .$onUpdate(now),
  },
  (t) => [index('plans_user_updated_idx').on(t.userId, t.updatedAt, t.id)],
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
  (t) => [
    uniqueIndex('plan_versions_plan_version_uq').on(t.planId, t.version),
    index('plan_versions_turn_idx').on(t.planId, t.messageId, t.source, t.version),
  ],
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
}, (t) => [index('cache_expires_idx').on(t.expiresAt)])

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
  (t) => [
    index('conversations_plan_idx').on(t.planId, t.updatedAt, t.id),
    index('conversations_user_updated_idx').on(t.userId, t.updatedAt, t.id),
  ],
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
    partsJson: text('parts_json', { mode: 'json' }),
    previewJson: text('preview_json', { mode: 'json' }),
    planVersionId: integer('plan_version_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt, t.id)],
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

/** Private image bytes never enter messages, plan JSON, or logs. */
export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  planId: integer('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  messageId: integer('message_id').references(() => messages.id, { onDelete: 'set null' }),
  filename: text('filename').notNull(), mediaType: text('media_type').notNull(),
  size: integer('size').notNull(), width: integer('width').notNull(), height: integer('height').notNull(),
  content: blob('content', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
}, t => [index('attachments_user_plan_idx').on(t.userId, t.planId), index('attachments_orphan_idx').on(t.messageId, t.createdAt)])

/** A retry may reuse the same bytes; every persisted message retains its own reference. */
export const attachmentLinks = sqliteTable('attachment_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  attachmentId: text('attachment_id').notNull().references(() => attachments.id, { onDelete: 'cascade' }),
  messageId: integer('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
}, t => [uniqueIndex('attachment_links_message_uq').on(t.attachmentId, t.messageId), index('attachment_links_message_idx').on(t.messageId)])

export const modelSettings = sqliteTable('model_settings', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  configurationJson: text('configuration_json', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
})

/** Derived resources do not change plan revisions or create plan versions. */
export const planResources = sqliteTable('plan_resources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  planId: integer('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  entityId: text('entity_id').notNull(), fingerprint: text('fingerprint').notNull(),
  planRevision: integer('plan_revision').notNull(), resourceJson: text('resource_json', { mode: 'json' }).notNull(),
  imageOriginUrl: text('image_origin_url'), imageCacheKey: text('image_cache_key'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(now),
}, t => [uniqueIndex('plan_resources_plan_entity_uq').on(t.planId, t.entityId), index('plan_resources_owner_idx').on(t.userId, t.planId)])

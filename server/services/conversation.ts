import { and, desc, eq, lt, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { MessageRole, MessageRecord, PageOptions, PlanPreview } from '../../shared/types'
import { conversations, messages } from '../database/schema'
import { db } from '../utils/db'
import { getPlanRow } from './plan'
import { finishPage, readPage } from './pagination'
import { bindAttachments } from './attachments'

/** 会话与消息持久化（硬约束 7） */

export async function listConversations(userId: string, planId?: number) {
  if (planId !== undefined) await getPlanRow(userId, planId)
  const where = planId
    ? and(eq(conversations.userId, userId), eq(conversations.planId, planId))
    : eq(conversations.userId, userId)
  return db
    .select({
      id: conversations.id,
      planId: conversations.planId,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(where)
    .orderBy(desc(conversations.updatedAt), desc(conversations.id))
}

export async function listConversationsPage(userId: string, planId?: number, options: PageOptions & { q?: string } = {}) {
  if (planId !== undefined) await getPlanRow(userId, planId)
  const keyword = options.q?.trim().toLocaleLowerCase() ?? ''
  const page = readPage(options, `conversations:${userId}:${planId ?? 'all'}:${keyword}`)
  const cursor = page.cursor
  const rows = await db.select({ id: conversations.id, planId: conversations.planId, title: conversations.title,
    createdAt: conversations.createdAt, updatedAt: conversations.updatedAt,
  }).from(conversations).where(and(eq(conversations.userId, userId), planId === undefined ? undefined : eq(conversations.planId, planId),
    keyword ? sql`instr(lower(${conversations.title}), ${keyword}) > 0` : undefined,
    cursor ? or(lt(conversations.updatedAt, new Date(cursor.sort)), and(eq(conversations.updatedAt, new Date(cursor.sort)), lt(conversations.id, cursor.id))) : undefined,
  )).orderBy(desc(conversations.updatedAt), desc(conversations.id)).limit(page.limit + 1)
  return finishPage(rows, page, (row) => ({ sort: row.updatedAt.getTime(), id: row.id }))
}

export async function getConversation(userId: string, id: number) {
  const row = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .get()
  if (!row) throw createError({ statusCode: 404, statusMessage: '会话不存在' })
  return row
}

export async function createConversation(userId: string, planId: number, title = '新对话') {
  await getPlanRow(userId, planId)
  const [row] = await db.insert(conversations).values({ userId, planId, title }).returning()
  return row!
}

export async function deleteConversation(userId: string, id: number) {
  const row = await getConversation(userId, id)
  await db.delete(conversations).where(eq(conversations.id, row.id))
  return { ok: true }
}

export async function touchConversation(id: number, title?: string) {
  await db
    .update(conversations)
    .set({ updatedAt: new Date(), ...(title ? { title } : {}) })
    .where(eq(conversations.id, id))
}

export async function listMessages(conversationId: number, limit = 200): Promise<MessageRecord[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit)
  return rows.reverse().map(toMessageRecord)
}

function toMessageRecord(r: typeof messages.$inferSelect): MessageRecord {
  return {
    id: r.id,
    conversationId: r.conversationId,
    role: r.role as MessageRole,
    content: r.content,
    parts: (r.partsJson ?? undefined) as MessageRecord['parts'],
    toolCalls: r.toolCalls ?? undefined,
    preview: (r.previewJson ?? null) as PlanPreview | null,
    planVersion: r.planVersionId ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

export async function listMessagesPage(userId: string, conversationId: number, options: PageOptions = {}) {
  await getConversation(userId, conversationId)
  const page = readPage(options, `messages:${userId}:${conversationId}`)
  const cursor = page.cursor
  const rows = await db.select().from(messages).where(and(eq(messages.conversationId, conversationId),
    cursor ? or(lt(messages.createdAt, new Date(cursor.sort)), and(eq(messages.createdAt, new Date(cursor.sort)), lt(messages.id, cursor.id))) : undefined,
  )).orderBy(desc(messages.createdAt), desc(messages.id)).limit(page.limit + 1)
  const result = finishPage(rows, page, (row) => ({ sort: row.createdAt.getTime(), id: row.id }))
  return { ...result, items: result.items.reverse().map(toMessageRecord) }
}

export async function appendMessage(
  conversationId: number,
  data: {
    role: MessageRole
    content?: string
    toolCalls?: unknown
    preview?: PlanPreview | null
    planVersionId?: number | null
    parts?: MessageRecord['parts']
    attachmentOwner?: { userId: string; planId: number; ids: string[] }
  },
) {
  const row = db.transaction(tx => {
    const row = tx.insert(messages)
    .values({
      conversationId,
      role: data.role,
      content: data.content ?? '',
      toolCalls: (data.toolCalls ?? null) as never,
      previewJson: (data.preview ?? null) as never,
      planVersionId: data.planVersionId ?? null,
      partsJson: data.parts ?? null,
    })
    .returning().get()
    if (data.attachmentOwner) bindAttachments(tx, data.attachmentOwner.ids, row.id, data.attachmentOwner.userId, data.attachmentOwner.planId)
    return row
  })
  await touchConversation(conversationId)
  return row
}

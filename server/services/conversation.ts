import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import type { MessageRole, MessageRecord, PlanPreview } from '../../shared/types'
import { conversations, messages } from '../database/schema'
import { db } from '../utils/db'
import { getPlanRow } from './plan'

/** 会话与消息持久化（硬约束 7） */

export async function listConversations(userId: string, planId?: number) {
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
    .orderBy(desc(conversations.updatedAt))
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
    .orderBy(messages.createdAt)
    .limit(limit)
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    role: r.role as MessageRole,
    content: r.content,
    toolCalls: r.toolCalls ?? undefined,
    preview: (r.previewJson ?? null) as PlanPreview | null,
    planVersion: r.planVersionId ?? null,
    createdAt: r.createdAt.toISOString(),
  }))
}

export async function appendMessage(
  conversationId: number,
  data: {
    role: MessageRole
    content?: string
    toolCalls?: unknown
    preview?: PlanPreview | null
    planVersionId?: number | null
  },
) {
  const [row] = await db
    .insert(messages)
    .values({
      conversationId,
      role: data.role,
      content: data.content ?? '',
      toolCalls: (data.toolCalls ?? null) as never,
      previewJson: (data.preview ?? null) as never,
      planVersionId: data.planVersionId ?? null,
    })
    .returning()
  await touchConversation(conversationId)
  return row!
}

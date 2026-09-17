import { and, asc, eq, sql } from 'drizzle-orm'
import type { MessageRecord } from '../../shared/types'
import { conversations, messages } from '../database/schema'
import { db } from '../utils/db'

/** Keep the initial requirements discoverable even after the recent conversational window rolls over. */
export function includeInitialRequirements(userId: string, conversationId: number, recent: MessageRecord[]): MessageRecord[] {
  const initial = db.select({ id: messages.id, content: sql<string>`substr(${messages.content}, 1, 4000)`, createdAt: messages.createdAt })
    .from(messages).innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.userId, userId), eq(conversations.id, conversationId), eq(messages.role, 'user')))
    .orderBy(asc(messages.createdAt), asc(messages.id)).limit(12).all()
  const ids = new Set(recent.map(record => record.id))
  return [...initial.filter(record => !ids.has(record.id)).map(record => ({ ...record, conversationId, role: 'user' as const, createdAt: record.createdAt.toISOString() })), ...recent]
}

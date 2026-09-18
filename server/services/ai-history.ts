import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { MessageRecord } from '../../shared/types'
import { conversations, messages } from '../database/schema'
import { db } from '../utils/db'

/** Keep the initial requirements discoverable even after the recent conversational window rolls over. */
export function includeInitialRequirements(userId: string, conversationId: number, recent: MessageRecord[]): MessageRecord[] {
  const initial = db.select({ id: messages.id, content: sql<string>`substr(${messages.content}, 1, 4000)`, parts: messages.partsJson, createdAt: messages.createdAt })
    .from(messages).innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.userId, userId), eq(conversations.id, conversationId), eq(messages.role, 'user')))
    .orderBy(asc(messages.createdAt), asc(messages.id)).limit(12).all()
  const ids = new Set(recent.map(record => record.id))
  // Pull image requirements independently of the rolling text window. Thirteen records allow
  // the application to detect and report its twelve-image limit instead of silently losing one.
  const illustrated = db.select({ id: messages.id, content: sql<string>`substr(${messages.content}, 1, 4000)`, parts: messages.partsJson, createdAt: messages.createdAt })
    .from(messages).innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.userId, userId), eq(conversations.id, conversationId), eq(messages.role, 'user'), sql`json_array_length(${messages.partsJson}) > 0`))
    .orderBy(desc(messages.createdAt), desc(messages.id)).limit(13).all()
  const retained = [...new Map([...initial, ...illustrated].map(record => [record.id, record])).values()].filter(record => !ids.has(record.id))
    .map(record => ({ ...record, parts: (record.parts ?? undefined) as MessageRecord['parts'], conversationId, role: 'user' as const, createdAt: record.createdAt.toISOString() }))
  return [...retained, ...recent].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt) || a.id - b.id)
}

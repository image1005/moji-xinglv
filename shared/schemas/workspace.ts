import { z } from 'zod'
import { PlanSchema } from './plan'
import { PlanPreviewSchema } from './preview'

const id = z.number().int().positive()
const timestamps = { createdAt: z.string(), updatedAt: z.string() }
const PlanSourceSchema = z.enum(['ai', 'user', 'rollback'])
export const SessionUserSchema = z.object({ id: z.string(), email: z.string(), name: z.string(), role: z.enum(['user', 'admin']) })
export const PlanListItemSchema = z.object({ id, title: z.string(), summary: z.string(), coverUrl: z.string(), version: z.number(), revision: z.number(), ...timestamps })
export const PlanDetailSchema = PlanListItemSchema.extend({ contentMd: z.string(), plan: PlanSchema })
export const ConversationSchema = z.object({ id, planId: id, title: z.string(), ...timestamps })
export const VersionSchema = z.object({ id, version: z.number(), source: PlanSourceSchema, parentVersionId: id.nullable(), messageId: id.nullable(), createdAt: z.string(),
  diffJson: z.array(z.object({ path: z.string(), before: z.unknown().optional(), after: z.unknown().optional(), kind: z.string() })).nullable() })
export const MessageSchema = z.object({ id, conversationId: id, role: z.enum(['user', 'assistant', 'tool', 'system']), content: z.string(),
  parts: z.array(z.object({ type: z.string() }).passthrough()).optional(),
  toolCalls: z.unknown().optional(), preview: PlanPreviewSchema.nullable().optional(), planVersion: z.number().nullable().optional(), createdAt: z.string() })
export const SaveResultSchema = z.object({ planId: id, version: z.number(), revision: z.number(), versionId: id.nullable(), skipped: z.boolean(), preview: PlanPreviewSchema })
export const ChatRunSchema = z.object({ requestId: z.string(), status: z.enum(['queued', 'running', 'completed', 'cancelled', 'failed', 'interrupted']), assistantMessageId: id.nullable(), planId: id, conversationId: id,
  startedAt: z.string(), updatedAt: z.string(), finishedAt: z.string().nullable(), errorCode: z.string().nullable(), steps: z.number() })
export const PageOptionsSchema = z.object({ limit: z.coerce.number().int().min(1).max(200).optional(), cursor: z.string().min(1).max(2048).optional() })
export function pageSchema<T extends z.ZodType>(item: T) { return z.object({ items: z.array(item), nextCursor: z.string().nullable(), hasMore: z.boolean() }) }
export type Page<T> = { items: T[]; nextCursor: string | null; hasMore: boolean }
export type PageOptions = z.infer<typeof PageOptionsSchema>
export type SessionUser = z.infer<typeof SessionUserSchema>
export type PlanListItem = z.infer<typeof PlanListItemSchema>
export type PlanDetail = z.infer<typeof PlanDetailSchema>
export type ConversationItem = z.infer<typeof ConversationSchema>
export type VersionItem = z.infer<typeof VersionSchema>
export type SaveResult = z.infer<typeof SaveResultSchema>
export type MessageRecord = z.infer<typeof MessageSchema>
export type ChatRun = z.infer<typeof ChatRunSchema>

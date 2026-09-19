import { and, eq, isNull, lt, notExists, sql } from 'drizzle-orm'
import { createError } from 'h3'
import sharp from 'sharp'
import { AttachmentSchema, ATTACHMENT_LIMITS, type Attachment } from '../../shared/schemas/attachment'
import { attachmentLinks, attachments, conversations, messages, plans } from '../database/schema'
import { db } from '../utils/db'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Reader = typeof db | Transaction
type AttachmentRow = typeof attachments.$inferSelect
const dto = (row: AttachmentRow): Attachment => AttachmentSchema.parse({ id: row.id, url: `/api/attachments/${row.id}`, filename: row.filename, mediaType: row.mediaType, size: row.size, width: row.width, height: row.height })
function assertPlan(conn: Reader, userId: string, planId: number) {
  if (!conn.select({ id: plans.id }).from(plans).where(and(eq(plans.id, planId), eq(plans.userId, userId))).get()) throw createError({ statusCode: 404, statusMessage: '规划不存在' })
}
export function maintainAttachments() {
  db.delete(attachments).where(and(notExists(db.select().from(attachmentLinks).where(eq(attachmentLinks.attachmentId, attachments.id))), lt(attachments.createdAt, new Date(Date.now() - 24 * 3600_000)))).run()
}
/** Full decode rejects truncated/mislabeled images; re-encoding strips EXIF and active metadata. */
async function prepareAttachmentImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > ATTACHMENT_LIMITS.bytes) throw createError({ statusCode: 413, statusMessage: '每张图片须小于 5 MiB' })
  try {
    const pipeline = sharp(bytes, { limitInputPixels: ATTACHMENT_LIMITS.pixels, failOn: 'warning' })
    const metadata = await pipeline.metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format || '') || (metadata.pages ?? 1) > 1 || !metadata.width || !metadata.height
      || metadata.width > ATTACHMENT_LIMITS.dimension || metadata.height > ATTACHMENT_LIMITS.dimension) throw new Error('Unsupported image')
    const { data, info } = await pipeline.rotate().webp({ quality: 90 }).toBuffer({ resolveWithObject: true })
    if (data.length > ATTACHMENT_LIMITS.bytes) throw new Error('Encoded image too large')
    return { content: data, mediaType: 'image/webp' as const, size: data.length, width: info.width, height: info.height }
  } catch { throw createError({ statusCode: 400, statusMessage: '图片无法解码；请使用静态 JPEG、PNG 或 WebP，边长不超过 8192 像素、总像素不超过 2400 万' }) }
}
export async function createAttachment(userId: string, planId: number, filename: string, bytes: Buffer): Promise<Attachment> {
  assertPlan(db, userId, planId)
  maintainAttachments()
  const prepared = await prepareAttachmentImage(bytes)
  return db.transaction(tx => {
    assertPlan(tx, userId, planId)
    const quota = tx.select({ bytes: sql<number>`coalesce(sum(${attachments.size}),0)` }).from(attachments).where(eq(attachments.userId, userId)).get()!
    const pending = tx.select({ count: sql<number>`count(*)` }).from(attachments).where(and(eq(attachments.userId, userId), notExists(tx.select().from(attachmentLinks).where(eq(attachmentLinks.attachmentId, attachments.id))))).get()!.count
    if (pending >= 20 || quota.bytes + prepared.size > 200 * 1024 * 1024) throw createError({ statusCode: 413, statusMessage: '附件存储额度已满，请移除未发送的附件或旧工作区' })
    const safeName = Array.from(filename).filter(char => char.charCodeAt(0) >= 32 && char !== '<' && char !== '>').join('').slice(0, 200) || '旅行图片'
    const row = tx.insert(attachments).values({ id: crypto.randomUUID(), userId, planId, filename: safeName, ...prepared }).returning().get()
    return dto(row)
  })
}
export function readAttachment(userId: string, id: string) {
  const row = db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.userId, userId))).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: '附件不存在' })
  return row
}
function scopedAttachments(conn: Reader, userId: string, planId: number, ids: readonly string[]) {
  if (ids.length > ATTACHMENT_LIMITS.count || new Set(ids).size !== ids.length) throw createError({ statusCode: 400, statusMessage: '每条消息最多 4 张图片，附件不可重复' })
  assertPlan(conn, userId, planId)
  return ids.map(id => {
    const row = conn.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.userId, userId), eq(attachments.planId, planId))).get()
    if (!row) throw createError({ statusCode: 404, statusMessage: '附件不存在或不属于当前工作区' })
    return row
  })
}
export function resolveAttachments(userId: string, planId: number, ids: readonly string[]): Attachment[] {
  return scopedAttachments(db, userId, planId, ids).map(dto)
}
/** Call only immediately before handing trusted messages to AI SDK/Mastra. */
export function attachmentModelParts(userId: string, planId: number, ids: readonly string[]) {
  return scopedAttachments(db, userId, planId, ids).map(row => ({ type: 'file' as const, mediaType: row.mediaType, filename: row.filename, url: `data:${row.mediaType};base64,${Buffer.from(row.content).toString('base64')}` }))
}
export function bindAttachments(tx: Transaction, ids: readonly string[], messageId: number, userId: string, planId: number) {
  const rows = scopedAttachments(tx, userId, planId, ids)
  // Binding is part of the user-message transaction; aborts roll back both records.
  if (!tx.select({ id: messages.id }).from(messages).innerJoin(conversations, eq(messages.conversationId, conversations.id)).where(and(eq(messages.id, messageId), eq(conversations.planId, planId), eq(conversations.userId, userId))).get()) throw createError({ statusCode: 400, statusMessage: '附件消息不存在或作用域不符' })
  for (const row of rows) {
    tx.insert(attachmentLinks).values({ attachmentId: row.id, messageId }).onConflictDoNothing().run()
    if (row.messageId === null) tx.update(attachments).set({ messageId }).where(eq(attachments.id, row.id)).run()
  }
}
export function removeAttachment(userId: string, id: string) {
  const row = readAttachment(userId, id)
  if (db.select().from(attachmentLinks).where(eq(attachmentLinks.attachmentId, row.id)).get()) throw createError({ statusCode: 409, statusMessage: '已发送附件随会话保留，删除会话或工作区时自动清理' })
  db.delete(attachments).where(and(eq(attachments.id, id), eq(attachments.userId, userId), isNull(attachments.messageId))).run()
  return { ok: true }
}

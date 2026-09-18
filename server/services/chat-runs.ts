import { createHash } from 'node:crypto'
import { and, asc, count, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { chatRuns } from '../database/operations'
import { conversations, messages } from '../database/schema'
import { aiConfig } from '../utils/ai-config'
import { db } from '../utils/db'
import { stableStringify } from '../../shared/utils/json'
import type { ModelConfiguration } from '../../shared/schemas/model-config'

export type RunStatus = typeof chatRuns.$inferSelect.status
export const publicRun = (row: typeof chatRuns.$inferSelect) => ({
  requestId: row.requestId, status: row.status, assistantMessageId: row.assistantMessageId,
  conversationId: row.conversationId, planId: row.planId, steps: row.steps, errorCode: row.errorCode,
  startedAt: row.startedAt.toISOString(), updatedAt: row.updatedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null,
})

const active = ['running', 'queued'] as const
const limitError = (message: string, retryAfter: number) => createError({ statusCode: 429, statusMessage: message, data: { retryAfter } })

/** Claim request identity before waiting or appending messages. A retry never executes tools again. */
export function claimRun(userId: string, requestId: string, planId: number, conversationId: number, input: { text: string; attachmentIds: string[]; configuration: ModelConfiguration }) {
  const config = aiConfig()
  const identity = { ...input, text: input.text.trim().normalize('NFC') }
  const hash = createHash('sha256').update(stableStringify({ planId, conversationId, ...identity })).digest('hex')
  return db.transaction(tx => {
    const existing = tx.select().from(chatRuns).where(and(eq(chatRuns.userId, userId), eq(chatRuns.requestId, requestId))).get()
    if (existing) throw createError({ statusCode: 409, statusMessage: existing.requestHash === hash ? '此请求已提交，请恢复已有生成结果' : '请求编号已用于其他内容，请使用新的请求编号', data: publicRun(existing) })
    const recent = tx.select({ total: count(), earliest: sql<number>`min(${chatRuns.startedAt})` }).from(chatRuns)
      .where(and(eq(chatRuns.userId, userId), gte(chatRuns.startedAt, new Date(Date.now() - config.AI_PERIOD_SECONDS * 1000)))).get()!
    if (recent.total >= config.AI_REQUESTS_PER_PERIOD) throw limitError('本周期 AI 请求额度已用完，请稍后再试', Math.max(1, Math.ceil((recent.earliest + config.AI_PERIOD_SECONDS * 1000 - Date.now()) / 1000)))
    const globalRecent = tx.select({ total: count(), earliest: sql<number>`min(${chatRuns.startedAt})` }).from(chatRuns)
      .where(gte(chatRuns.startedAt, new Date(Date.now() - config.AI_PERIOD_SECONDS * 1000))).get()!
    if (globalRecent.total >= config.AI_GLOBAL_REQUESTS_PER_PERIOD) throw limitError('服务本周期 AI 请求额度已用完，请稍后再试', Math.max(1, Math.ceil((globalRecent.earliest + config.AI_PERIOD_SECONDS * 1000 - Date.now()) / 1000)))
    const current = tx.select().from(chatRuns).where(inArray(chatRuns.status, [...active])).all()
    if (current.some(row => row.planId === planId)) throw createError({ statusCode: 409, statusMessage: '该规划正在生成，请等待完成后再发送' })
    const running = current.filter(row => row.status === 'running')
    const canRun = running.length < config.AI_GLOBAL_CONCURRENCY && running.filter(row => row.userId === userId).length < config.AI_USER_CONCURRENCY && !current.some(row => row.status === 'queued' && row.userId === userId)
    if (!canRun && (current.filter(row => row.status === 'queued').length >= config.AI_QUEUE_LIMIT || config.AI_QUEUE_WAIT_MS === 0)) throw limitError('AI 正在繁忙，请稍后重试', 5)
    return tx.insert(chatRuns).values({ userId, requestId, requestHash: hash, planId, conversationId, configurationJson: identity.configuration, status: canRun ? 'running' : 'queued' }).returning().get()
  }, { behavior: 'immediate' })
}

/** Single SQLite writer makes slot assignment and per-user FIFO selection atomic. Wait is bounded. */
export async function waitForRun(id: number, signal: AbortSignal) {
  const config = aiConfig()
  const until = Date.now() + config.AI_QUEUE_WAIT_MS
  while (true) {
    signal.throwIfAborted()
    const admitted = db.transaction(tx => {
      const row = tx.select().from(chatRuns).where(eq(chatRuns.id, id)).get()!
      if (row.status === 'running') return true
      if (row.status !== 'queued') throw createError({ statusCode: 409, statusMessage: '生成任务已结束，请恢复已有结果' })
      const running = tx.select().from(chatRuns).where(eq(chatRuns.status, 'running')).all()
      const firstForUser = tx.select({ id: chatRuns.id }).from(chatRuns).where(and(eq(chatRuns.status, 'queued'), eq(chatRuns.userId, row.userId))).orderBy(asc(chatRuns.id)).get()
      if (running.length >= config.AI_GLOBAL_CONCURRENCY || running.filter(item => item.userId === row.userId).length >= config.AI_USER_CONCURRENCY || firstForUser?.id !== id) return false
      tx.update(chatRuns).set({ status: 'running', updatedAt: new Date() }).where(eq(chatRuns.id, id)).run()
      return true
    }, { behavior: 'immediate' })
    if (admitted) return
    if (Date.now() >= until) {
      finishRun(id, 'failed', 'queue_timeout')
      throw limitError('AI 等待超时，请稍后重新发送', 5)
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 200)
      signal.addEventListener('abort', abort, { once: true })
    })
  }
}

export function attachRunMessage(id: number, assistantMessageId: number) {
  db.update(chatRuns).set({ assistantMessageId, updatedAt: new Date() }).where(eq(chatRuns.id, id)).run()
}

export function checkpointRun(id: number, steps?: number) {
  db.update(chatRuns).set({ updatedAt: new Date(), ...(steps === undefined ? {} : { steps }) }).where(and(eq(chatRuns.id, id), inArray(chatRuns.status, [...active]))).run()
}

export function finishRun(id: number, status: Exclude<RunStatus, 'running' | 'queued'>, errorCode?: string) {
  db.update(chatRuns).set({ status, errorCode: errorCode ?? null, updatedAt: new Date(), finishedAt: new Date() })
    .where(and(eq(chatRuns.id, id), inArray(chatRuns.status, [...active]))).run()
}

/** Called once on server startup. Version commits already persisted their preview in the same transaction. */
export function recoverInterruptedRuns() {
  return db.transaction(tx => {
    const unfinished = tx.select().from(chatRuns).where(inArray(chatRuns.status, [...active])).all()
    for (const row of unfinished) {
      if (row.assistantMessageId) tx.update(messages).set({ content: sql`${messages.content} || '\n\n[生成因服务重启中断，已保存的行程与预览已恢复；请发送新消息继续。]'` })
        .where(and(eq(messages.id, row.assistantMessageId), eq(messages.conversationId, row.conversationId))).run()
      tx.update(chatRuns).set({ status: 'interrupted', errorCode: 'server_restart', updatedAt: new Date(), finishedAt: new Date() }).where(eq(chatRuns.id, row.id)).run()
    }
    return unfinished.length
  })
}

export function listRuns(userId: string, conversationId: number) {
  const owner = db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))).get()
  if (!owner) throw createError({ statusCode: 404, statusMessage: '会话不存在' })
  return db.select().from(chatRuns).where(and(eq(chatRuns.userId, userId), eq(chatRuns.conversationId, conversationId))).orderBy(desc(chatRuns.id)).limit(20).all().map(publicRun)
}

import { and, eq, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import { agentsMd } from '../database/schema'
import { db } from '../utils/db'
import { getPlanRow } from './plan'

/**
 * AGENTS.md 注入（硬约束 8）：plan 级 > user 级 > 系统默认；
 * 变量占位 + 长度上限 + 防注入过滤，服务端拼装。
 */

export const AGENTS_MD_MAX_LENGTH = 4000

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|above|prior)\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|above|prior)\s+instructions?/gi,
  /忽略(以上|之前|前面|先前).{0,12}(指令|要求|规则)/g,
  /无视(以上|之前|前面|先前).{0,12}(指令|要求|规则)/g,
  /<\|im_(start|end)\|>/gi,
  /<system>|<\/system>/gi,
]

export function sanitizeAgentsMd(content: string): string {
  let text = content.split(String.fromCharCode(0)).join('')
  for (const pattern of INJECTION_PATTERNS) text = text.replace(pattern, '[已过滤]')
  return text.slice(0, AGENTS_MD_MAX_LENGTH)
}

export function renderAgentsMd(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (raw, key: string) => vars[key] ?? raw)
}

export const DEFAULT_AGENTS_MD = '（系统默认：无额外偏好。请给出结构清晰、节奏从容的行程建议。）'

export async function resolveAgentsMd(
  userId: string,
  planId: number | null,
  vars: Record<string, string> = {},
): Promise<string> {
  if (planId !== null) await getPlanRow(userId, planId)
  const rows = await db.select().from(agentsMd).where(eq(agentsMd.userId, userId))
  const planLevel = rows.find((r) => r.planId === planId && planId !== null && r.content)
  const userLevel = rows.find((r) => r.planId === null && r.content)
  const template = planLevel?.content || userLevel?.content || DEFAULT_AGENTS_MD
  const label = planLevel ? '计划级' : userLevel ? '用户级' : '系统默认'
  return `# 用户偏好（来源：${label} AGENTS.md）\n${sanitizeAgentsMd(renderAgentsMd(template, vars))}`
}

function scope(userId: string, planId: number | null) {
  return and(eq(agentsMd.userId, userId), planId === null ? isNull(agentsMd.planId) : eq(agentsMd.planId, planId))
}

export async function getAgentsMd(userId: string, planId: number | null) {
  if (planId !== null) await getPlanRow(userId, planId)
  return db.select().from(agentsMd).where(scope(userId, planId)).get() ?? null
}

export async function saveAgentsMd(userId: string, planId: number | null, content: string, expectedVersion?: number) {
  if (planId !== null) await getPlanRow(userId, planId)
  if (content.length > AGENTS_MD_MAX_LENGTH) {
    throw createError({ statusCode: 400, statusMessage: `AGENTS.md 不得超过 ${AGENTS_MD_MAX_LENGTH} 字符` })
  }
  const clean = sanitizeAgentsMd(content)
  return db.transaction((tx) => {
    const existing = tx.select().from(agentsMd).where(scope(userId, planId)).get()
    if (expectedVersion !== undefined && expectedVersion !== (existing?.version ?? 0)) {
      throw createError({ statusCode: 409, statusMessage: '偏好已更新，请比较最新内容后重新保存', data: { currentVersion: existing?.version ?? 0 } })
    }
    if (existing?.content === clean) return { id: existing.id, version: existing.version }
    if (existing) {
      tx.update(agentsMd).set({ content: clean, version: existing.version + 1, updatedAt: new Date() })
        .where(eq(agentsMd.id, existing.id)).run()
      return { id: existing.id, version: existing.version + 1 }
    }
    const row = tx.insert(agentsMd).values({ userId, planId, content: clean }).returning().get()
    return { id: row.id, version: row.version }
  }, { behavior: 'immediate' })
}

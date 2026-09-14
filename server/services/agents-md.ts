import { eq } from 'drizzle-orm'
import { agentsMd } from '../database/schema'
import { db } from '../utils/db'

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
  const rows = await db.select().from(agentsMd).where(eq(agentsMd.userId, userId))
  const planLevel = planId ? rows.find((r) => r.planId === planId) : undefined
  const userLevel = rows.find((r) => r.planId === null)
  const template = planLevel?.content || userLevel?.content || DEFAULT_AGENTS_MD
  const label = planLevel ? '计划级' : userLevel ? '用户级' : '系统默认'
  return `# 用户偏好（来源：${label} AGENTS.md）\n${renderAgentsMd(sanitizeAgentsMd(template), vars)}`
}

export async function getAgentsMd(userId: string, planId: number | null) {
  const rows = await db.select().from(agentsMd).where(eq(agentsMd.userId, userId)).all()
  return rows.find((r) => r.planId === planId) ?? null
}

export async function saveAgentsMd(userId: string, planId: number | null, content: string) {
  const clean = sanitizeAgentsMd(content).slice(0, AGENTS_MD_MAX_LENGTH)
  const existing = (
    await db.select().from(agentsMd).where(eq(agentsMd.userId, userId)).all()
  ).find((r) => r.planId === planId)
  if (existing) {
    await db
      .update(agentsMd)
      .set({ content: clean, version: existing.version + 1, updatedAt: new Date() })
      .where(eq(agentsMd.id, existing.id))
    return { id: existing.id, version: existing.version + 1 }
  }
  const [row] = await db.insert(agentsMd).values({ userId, planId, content: clean }).returning()
  return { id: row!.id, version: row!.version }
}

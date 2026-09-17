import type { Plan } from './schemas/plan'

export type PlanSource = 'ai' | 'user' | 'rollback'

export interface Page<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

export interface PageOptions {
  limit?: number
  cursor?: string
}

export interface PlanPreviewDay {
  date: string
  city: string
  spots: { name: string; time: string; panorama: string }[]
}

/** 聊天流中的可视化预览卡片数据（PRD §3.4 / 硬约束 6） */
export interface PlanPreview {
  planId: number
  version: number
  title: string
  summary: string
  cover: string
  days: PlanPreviewDay[]
  source: PlanSource
  message?: string
}

export function toPlanPreview(plan: Plan, planId: number, version: number, source: PlanSource, message?: string): PlanPreview {
  return {
    planId,
    version,
    title: plan.title,
    summary: plan.summary,
    cover: plan.cover,
    days: plan.days.map((d) => ({
      date: d.date,
      city: d.city,
      spots: d.spots.map((s) => ({ name: s.name, time: s.time, panorama: s.panorama })),
    })),
    source,
    message,
  }
}

export interface ConversationRecord {
  id: number
  planId: number
  title: string
  createdAt: string
  updatedAt: string
}

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system'

export interface MessageRecord {
  id: number
  conversationId: number
  role: MessageRole
  content: string
  toolCalls?: unknown
  preview?: PlanPreview | null
  planVersion?: number | null
  createdAt: string
}

export interface VersionRecord {
  id: number
  version: number
  source: PlanSource
  parentVersionId: number | null
  messageId: number | null
  createdAt: string
}

import type { Plan } from '#shared/schemas/plan'
import type { MessageRecord, PlanPreview, PlanSource } from '#shared/types'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: 'user' | 'admin'
}

export interface PlanListItem {
  id: number
  title: string
  summary: string
  coverUrl: string
  version: number
  revision: number
  createdAt: string
  updatedAt: string
}

export interface PlanDetail {
  id: number
  title: string
  summary: string
  contentMd: string
  coverUrl: string
  plan: Plan
  version: number
  revision: number
  createdAt: string
  updatedAt: string
}

export interface ConversationItem {
  id: number
  planId: number
  title: string
  createdAt: string
  updatedAt: string
}

export interface VersionItem {
  id: number
  version: number
  source: PlanSource
  parentVersionId: number | null
  messageId: number | null
  createdAt: string
  diffJson: { path: string; before?: unknown; after?: unknown; kind: string }[] | null
}

export interface SaveResult {
  planId: number
  version: number
  revision: number
  versionId: number | null
  skipped: boolean
  preview: PlanPreview
}

export interface Page<T> { items: T[]; nextCursor: string | null; hasMore: boolean }
export interface MessagePage { nextCursor: string | null; hasMore: boolean }
export interface ChatRun {
  requestId: string; status: string; assistantMessageId: number | null; planId: number; conversationId: number
  startedAt: string; updatedAt: string; finishedAt: string | null; errorCode: string | null; steps: number
}

export function apiErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  type ErrorValue = { statusCode?: number; status?: number; statusMessage?: string; data?: { message?: string; statusMessage?: string }; message?: string }
  let value = error as ErrorValue | null
  // AI SDK 的非 2xx 流响应封装为 Error(JSON 文本)，没有 FetchError 的 status/data。
  if (typeof value?.message === 'string' && value.message.length <= 16000 && value.message.trim().startsWith('{')) {
    try {
      const body: unknown = JSON.parse(value.message)
      if (body && typeof body === 'object' && 'statusCode' in body && typeof body.statusCode === 'number') value = body as ErrorValue
    } catch { /* 普通文本错误按原内容显示。 */ }
  }
  const detail = value?.data?.statusMessage || value?.data?.message || value?.statusMessage
  if (value?.statusCode === 409 || value?.status === 409) {
    if (detail?.includes('请求') || detail?.includes('偏好')) return detail
    return '版本冲突：规划已被更新，请先重载最新版本再保存。未保存的草稿仍保留。'
  }
  if (value?.statusCode === 429 || value?.status === 429) return detail || '当前生成任务较多或本周期额度已用完，请稍后再试。内容已保留。'
  return detail || value?.message || fallback
}

export const api = {
  me: () => $fetch<{ user: SessionUser }>('/api/me'),

  plans: {
    list: () => $fetch<PlanListItem[]>('/api/plans'),
    listPage: (cursor?: string, q?: string, sort?: 'created' | 'updated') => $fetch<Page<PlanListItem>>('/api/plans', { query: { paged: true, limit: 50, cursor, q, sort } }),
    create: (body: { title?: string; planJson?: unknown }) =>
      $fetch<{ planId: number; version: number }>('/api/plans', { method: 'POST', body }),
    detail: (id: number) => $fetch<PlanDetail>(`/api/plans/${id}`),
    updateMeta: (id: number, body: {
      title?: string
      summary?: string
      cover?: string
      tags?: string[]
      tips?: string[]
      budget?: Plan['budget']
      contentMd?: string
      expectedVersion?: number
      expectedRevision?: number
    }) => $fetch<{ ok: boolean; revision: number }>(`/api/plans/${id}`, { method: 'PATCH', body }),
    remove: (id: number) => $fetch<{ ok: boolean }>(`/api/plans/${id}`, { method: 'DELETE' }),
    save: (id: number, body: { planJson?: unknown; conversationId?: number; expectedVersion?: number; expectedRevision?: number }) =>
      $fetch<SaveResult>(`/api/plans/${id}/save`, { method: 'POST', body }),
    switchVersion: (id: number, body: { version: number; conversationId?: number; expectedVersion?: number; expectedRevision?: number }) =>
      $fetch<{ version: number; revision: number; versionId: number; switched: true; preview: PlanPreview }>(`/api/plans/${id}/switch`, {
        method: 'POST',
        body,
      }),
    versions: (id: number) => $fetch<VersionItem[]>(`/api/plans/${id}/versions`),
    versionsPage: (id: number, cursor?: string) => $fetch<Page<VersionItem>>(`/api/plans/${id}/versions`, { query: { paged: true, limit: 50, cursor } }),
    versionPlan: (id: number, version: number) =>
      $fetch<{ plan: Plan }>(`/api/plans/${id}/versions/${version}`),
  },

  conversations: {
    list: (planId?: number) =>
      $fetch<ConversationItem[]>('/api/conversations', { query: planId ? { planId } : {} }),
    listPage: (planId?: number, cursor?: string, q?: string) => $fetch<Page<ConversationItem>>('/api/conversations', { query: { paged: true, limit: 50, planId, cursor, q } }),
    create: (planId: number, title?: string) =>
      $fetch<ConversationItem>('/api/conversations', { method: 'POST', body: { planId, title } }),
    detail: (id: number) =>
      $fetch<{ conversation: ConversationItem; messages: MessageRecord[] }>(`/api/conversations/${id}`),
    messagesPage: (id: number, cursor?: string) => $fetch<{ conversation: ConversationItem; messages: MessageRecord[]; messagePage: MessagePage }>(`/api/conversations/${id}`, { query: { paged: true, limit: 50, cursor } }),
    remove: (id: number) => $fetch<{ ok: boolean }>(`/api/conversations/${id}`, { method: 'DELETE' }),
  },

  chatRuns: (conversationId: number) => $fetch<ChatRun[]>('/api/chat/runs', { query: { conversationId } }),

  agentsMd: {
    get: (planId?: number | null) =>
      $fetch<{ planId: number | null; content: string; version: number }>('/api/agents-md', {
        query: planId ? { planId } : {},
      }),
    save: (body: { planId: number | null; content: string; expectedVersion?: number }) =>
      $fetch<{ ok: boolean; version: number }>('/api/agents-md', { method: 'PUT', body }),
  },

  panoramaUrl: (params: { location: string; heading?: number; fov?: number; width?: number; height?: number }) => {
    const search = new URLSearchParams({ location: params.location })
    if (params.width) search.set('width', String(params.width))
    if (params.height) search.set('height', String(params.height))
    if (params.heading !== undefined) search.set('heading', String(params.heading))
    if (params.fov !== undefined) search.set('fov', String(params.fov))
    return `/api/panorama?${search.toString()}`
  },

  admin: {
    stats: () =>
      $fetch<{
        plans: number
        conversations: number
        messages: number
        cache: { total: number; expired: number; bytes: number }
        metrics: { service: string; requests: number; errors: number; cacheHits: number; durationMs: number; inputTokens: number; outputTokens: number; usageSamples: number; steps: number }[]
        runs: { status: string; count: number }[]
        recentRuns: ChatRun[]
      }>('/api/admin/stats'),
    users: () =>
      $fetch<
        { id: string; name: string; email: string; role: string | null; banned: boolean | null; createdAt: string; planCount: number }[]
      >('/api/admin/users'),
    updateUser: (id: string, body: { role?: 'user' | 'admin'; banned?: boolean }) =>
      $fetch<{ ok: boolean }>(`/api/admin/users/${id}`, { method: 'PATCH', body }),
    plans: () =>
      $fetch<{ id: number; title: string; summary: string; updatedAt: string; userEmail: string | null }[]>(
        '/api/admin/plans',
      ),
    deletePlan: (id: number) => $fetch<{ ok: boolean }>(`/api/admin/plans/${id}`, { method: 'DELETE' }),
    cache: () =>
      $fetch<{
        stats: { total: number; expired: number; bytes: number }
        entries: { key: string; type: string; size: number; expiresAt: string; createdAt: string; expired: boolean }[]
      }>('/api/admin/cache'),
    clearCache: (prefix?: string) =>
      $fetch<{ ok: boolean; removed: number }>('/api/admin/cache', { method: 'DELETE', body: { prefix } }),
  },
}

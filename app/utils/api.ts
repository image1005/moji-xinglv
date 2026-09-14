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
  versionId: number | null
  skipped: boolean
  preview: PlanPreview
}

export const api = {
  me: () => $fetch<{ user: SessionUser }>('/api/me'),

  plans: {
    list: () => $fetch<PlanListItem[]>('/api/plans'),
    create: (body: { title?: string; planJson?: unknown }) =>
      $fetch<{ planId: number; version: number }>('/api/plans', { method: 'POST', body }),
    detail: (id: number) => $fetch<PlanDetail>(`/api/plans/${id}`),
    updateMeta: (id: number, body: { title?: string; summary?: string; contentMd?: string }) =>
      $fetch<{ ok: boolean }>(`/api/plans/${id}`, { method: 'PATCH', body }),
    remove: (id: number) => $fetch<{ ok: boolean }>(`/api/plans/${id}`, { method: 'DELETE' }),
    save: (id: number, body: { planJson?: unknown; conversationId?: number }) =>
      $fetch<SaveResult>(`/api/plans/${id}/save`, { method: 'POST', body }),
    rollback: (id: number, body: { version: number; conversationId?: number }) =>
      $fetch<{ version: number; preview: PlanPreview }>(`/api/plans/${id}/rollback`, {
        method: 'POST',
        body,
      }),
    versions: (id: number) => $fetch<VersionItem[]>(`/api/plans/${id}/versions`),
    versionPlan: (id: number, version: number) =>
      $fetch<{ plan: Plan }>(`/api/plans/${id}/versions/${version}`),
  },

  conversations: {
    list: (planId?: number) =>
      $fetch<ConversationItem[]>('/api/conversations', { query: planId ? { planId } : {} }),
    create: (planId: number, title?: string) =>
      $fetch<ConversationItem>('/api/conversations', { method: 'POST', body: { planId, title } }),
    detail: (id: number) =>
      $fetch<{ conversation: ConversationItem; messages: MessageRecord[] }>(`/api/conversations/${id}`),
    remove: (id: number) => $fetch<{ ok: boolean }>(`/api/conversations/${id}`, { method: 'DELETE' }),
  },

  agentsMd: {
    get: (planId?: number | null) =>
      $fetch<{ planId: number | null; content: string; version: number }>('/api/agents-md', {
        query: planId ? { planId } : {},
      }),
    save: (body: { planId: number | null; content: string }) =>
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
        baidu: { panoramaImages: number; staticMaps: number; poiQueries: number }
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

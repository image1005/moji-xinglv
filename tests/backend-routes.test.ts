import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  appendMessage: vi.fn(),
  savePlanVersion: vi.fn(),
  switchToVersion: vi.fn(),
  updatePlanMeta: vi.fn(),
  clearCache: vi.fn(),
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
}))
vi.mock('../server/services/conversation', () => ({ getConversation: mocks.getConversation, appendMessage: mocks.appendMessage }))
vi.mock('../server/services/plan', () => ({
  savePlanVersion: mocks.savePlanVersion,
  switchToVersion: mocks.switchToVersion,
  updatePlanMeta: mocks.updatePlanMeta,
}))
vi.mock('../server/services/cache', () => ({ clearCache: mocks.clearCache }))
vi.mock('../server/utils/session', () => ({ requireUser: mocks.requireUser, requireAdmin: mocks.requireAdmin }))

let body: unknown
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('getRouterParam', () => '1')
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('readValidatedBody', async (_event: unknown, parse: (input: unknown) => unknown) => {
    try { return parse(body) } catch { throw createError({ statusCode: 400, statusMessage: '参数不合法' }) }
  })
  mocks.requireUser.mockResolvedValue({ id: 'owner' })
  mocks.requireAdmin.mockResolvedValue({ id: 'owner' })
  mocks.clearCache.mockResolvedValue(2)
})
afterEach(() => vi.unstubAllGlobals())

async function handler(route: 'save' | 'switch' | 'patch' | 'cache') {
  const modules = {
    save: () => import('../server/api/plans/[id]/save.post'),
    switch: () => import('../server/api/plans/[id]/switch.post'),
    patch: () => import('../server/api/plans/[id].patch'),
    cache: () => import('../server/api/admin/cache.delete'),
  }
  return (await modules[route]()).default as (event: unknown) => Promise<unknown>
}

describe('有副作用的路由先校验参数与作用域', () => {
  it.each(['save', 'switch'] as const)('%s 拒绝其他规划会话且不发生写入', async (route) => {
    body = { conversationId: 10, version: 1, expectedVersion: 2 }
    mocks.getConversation.mockResolvedValue({ planId: 2 })
    await expect((await handler(route))({})).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.savePlanVersion).not.toHaveBeenCalled()
    expect(mocks.switchToVersion).not.toHaveBeenCalled()
    expect(mocks.appendMessage).not.toHaveBeenCalled()
  })
  it.each(['save', 'switch'] as const)('%s 传递 expectedVersion 并传播409', async (route) => {
    body = { version: 1, expectedVersion: 2 }
    mocks.savePlanVersion.mockRejectedValue(createError({ statusCode: 409 }))
    mocks.switchToVersion.mockRejectedValue(createError({ statusCode: 409 }))
    await expect((await handler(route))({})).rejects.toMatchObject({ statusCode: 409 })
    const write = route === 'save' ? mocks.savePlanVersion : mocks.switchToVersion
    expect(write.mock.calls[0]!.at(-1)).toMatchObject({ expectedVersion: 2 })
    expect(mocks.appendMessage).not.toHaveBeenCalled()
  })
  it('切换版本将会话与修订校验交给原子服务且不重复追加消息', async () => {
    body = { version: 1, expectedVersion: 2, expectedRevision: 5, conversationId: 10 }
    mocks.getConversation.mockResolvedValue({ planId: 1 })
    mocks.switchToVersion.mockResolvedValue({
      planId: 1, version: 1, versionId: 7, switched: true, preview: { planId: 1, version: 1 },
    })
    await expect((await handler('switch'))({})).resolves.toMatchObject({ switched: true, version: 1 })
    expect(mocks.switchToVersion).toHaveBeenCalledWith('owner', 1, 1, { expectedVersion: 2, expectedRevision: 5, conversationId: 10 })
    expect(mocks.appendMessage).not.toHaveBeenCalled()
  })
  it('规划资料 PATCH 透传扩展字段并拒绝非法预算', async () => {
    body = { title: '新标题', summary: '摘要', cover: 'https://example.test/cover.jpg', tags: ['江南'], tips: ['带伞'], budget: { total: 1200, currency: 'CNY' }, expectedVersion: 3 }
    mocks.updatePlanMeta.mockResolvedValue({ version: 4 })
    await expect((await handler('patch'))({})).resolves.toMatchObject({ ok: true, version: 4 })
    expect(mocks.updatePlanMeta).toHaveBeenCalledWith('owner', 1, body)
    for (const invalid of [{ budget: { total: -1, currency: 'CNY' } }, { tags: ['a'.repeat(41)] }, { budget: { total: 1, currency: 'cny' } }]) {
      body = invalid
      await expect((await handler('patch'))({})).rejects.toMatchObject({ statusCode: 400 })
    }
    expect(mocks.updatePlanMeta).toHaveBeenCalledTimes(1)
  })

  it.each([null, [], { prefix: 2 }, { prefix: '' }, { typo: 'json:' }])('非法缓存清理 body %j 保留400且不清理', async (invalid) => {
    body = invalid
    await expect((await handler('cache'))({})).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.clearCache).not.toHaveBeenCalled()
  })
  it('显式空对象允许全量清理', async () => {
    body = {}
    await expect((await handler('cache'))({})).resolves.toEqual({ ok: true, removed: 2 })
    expect(mocks.clearCache).toHaveBeenCalledWith(undefined)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createWorkspaceDocument } from '../app/features/workspace/document'
import { VersionMetadataSchema, type VersionMetadata } from '../app/utils/version-metadata'
import type { PlanDetail } from '../app/utils/api'

const mocks = vi.hoisted(() => ({ versionsPage: vi.fn(), renameVersion: vi.fn(), detail: vi.fn(), restoreDraft: vi.fn() }))
vi.mock('~/utils/api', () => ({ api: { plans: mocks } }))
vi.mock('~/utils/idb', () => ({ idbGet: async () => null, idbSet: async () => undefined }))
beforeEach(() => vi.resetAllMocks())

function item(version: number, nameRevision = 0, name: string | null = null) {
  return VersionMetadataSchema.parse({ id: 100 + version, version, source: 'user', parentVersionId: null, messageId: null, createdAt: '2026-09-30', diffJson: [], name, nameRevision })
}
function page(items: VersionMetadata[], nextCursor: string | null = null) { return { items, nextCursor, hasMore: nextCursor !== null } }
function setup() {
  let navigation = 0
  const document = createWorkspaceDocument({ navigation: () => navigation, lifetime: () => 0, conversationId: () => null, matchingConversation: () => undefined, reloadConversation: vi.fn(), rememberPlan: vi.fn(), errorMessage: ref('') })
  document.currentPlan.value = { id: 1, version: 5, revision: 12, plan: { title: '当前行程' } } as PlanDetail
  return { document, navigate: () => { navigation++; document.clearOtherPlan(2) } }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { resolve, reject, promise }
}

describe('独立版本名称状态与分页', () => {
  it('强制刷新已加载的所有页，不依赖规划 revision，不重置历史分页', async () => {
    const { document } = setup()
    mocks.versionsPage.mockResolvedValueOnce(page([item(5), item(4)], 'p2')).mockResolvedValueOnce(page([item(3), item(2)], 'p3'))
    await document.loadVersions()
    await document.loadVersions(true)
    expect(await document.loadVersions()).toBe(false)
    mocks.versionsPage.mockResolvedValueOnce(page([item(5, 1, '新名称'), item(4)], 'p2')).mockResolvedValueOnce(page([item(3), item(2, 1, '旧版新名称')], 'p3'))
    await document.loadVersions(false, true)
    expect(document.versions.value.map(v => v.name)).toEqual(['新名称', null, null, '旧版新名称'])
    mocks.versionsPage.mockResolvedValueOnce(page([item(1)]))
    await document.loadVersions(true)
    expect(mocks.versionsPage).toHaveBeenLastCalledWith(1, 'p3')
    expect(document.currentPlan.value).toMatchObject({ version: 5, revision: 12 })
  })
  it('打开历史元数据只更新已有节点，分页查询不会增加节点或修改当前行程', async () => {
    const { document } = setup()
    document.versions.value = [item(5), item(2)]
    const before = JSON.stringify(document.currentPlan.value)
    mocks.versionsPage.mockResolvedValueOnce(page([item(5), item(4)], 'p2')).mockResolvedValueOnce(page([item(3), item(2, 2, '旧城')]))
    expect(await document.refreshVersionMetadata(2)).toMatchObject({ name: '旧城', nameRevision: 2 })
    expect(document.versions.value.map(v => v.version)).toEqual([5, 2])
    expect(JSON.stringify(document.currentPlan.value)).toBe(before)
  })
  it('历史版本改名直接合并返回元数据，不切换/重载当前行程，也不更改保存状态', async () => {
    const { document } = setup()
    document.versions.value = [item(5), item(2)]
    mocks.renameVersion.mockResolvedValue({ version: item(2, 1, '古城一日') })
    expect(await document.renameVersion(2, '古城一日', 0)).toMatchObject({ name: '古城一日' })
    expect(mocks.renameVersion).toHaveBeenCalledWith(1, 2, { name: '古城一日', expectedNameRevision: 0 })
    expect(document.currentPlan.value).toMatchObject({ version: 5, revision: 12 })
    expect(document.versions.value).toHaveLength(2)
    expect(document.savedAt.value).toBeNull()
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it('改名后到达的旧列表不能覆盖较新的名称修订号', async () => {
    const { document } = setup()
    document.versions.value = [item(5)]
    const pending = deferred<ReturnType<typeof page>>()
    mocks.versionsPage.mockReturnValueOnce(pending.promise)
    const loading = document.loadVersions(false, true)
    mocks.renameVersion.mockResolvedValue({ version: item(5, 1, '保留新名') })
    await document.renameVersion(5, '保留新名', 0)
    pending.resolve(page([item(5)]))
    await loading
    expect(document.versions.value[0]?.name).toBe('保留新名')
  })
  it('列表加载期间规划修订号变化时，补刷新最新节点并保持加载状态直到完成', async () => {
    const { document } = setup()
    const older = deferred<ReturnType<typeof page>>()
    const latest = deferred<ReturnType<typeof page>>()
    mocks.versionsPage.mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise)
    const loading = document.loadVersions()
    document.currentPlan.value = { ...document.currentPlan.value!, version: 6, revision: 13 }
    // The revision watcher fires while the first request still owns the loader.
    expect(await document.loadVersions()).toBe(false)
    older.resolve(page([item(5)]))
    await Promise.resolve()
    expect(mocks.versionsPage).toHaveBeenCalledTimes(2)
    expect(document.loadingVersions.value).toBe(true)
    latest.resolve(page([item(6), item(5)]))
    expect(await loading).toBe(true)
    expect(document.versions.value.map(version => version.version)).toEqual([6, 5])
    expect(document.loadingVersions.value).toBe(false)
    expect(document.currentPlan.value).toMatchObject({ version: 6, revision: 13 })
    expect(await document.loadVersions()).toBe(false)
    expect(mocks.versionsPage).toHaveBeenCalledTimes(2)
  })
  it('强制刷新取代旧请求后，旧请求失败不向外泄露或提前结束新请求的加载状态', async () => {
    const { document } = setup()
    document.versions.value = [item(5)]
    const older = deferred<ReturnType<typeof page>>()
    const latest = deferred<ReturnType<typeof page>>()
    mocks.versionsPage.mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise)
    const original = document.loadVersions()
    const forced = document.loadVersions(false, true)
    older.reject(new Error('已过期请求的网络错误'))
    await expect(original).resolves.toBe(false)
    expect(document.loadingVersions.value).toBe(true)
    expect(document.versions.value.map(version => version.version)).toEqual([5])
    latest.resolve(page([item(6), item(5, 1, '最新名称')]))
    await expect(forced).resolves.toBe(true)
    expect(document.loadingVersions.value).toBe(false)
    expect(document.versions.value.map(version => version.version)).toEqual([6, 5])
    expect(document.versions.value[1]?.name).toBe('最新名称')
  })
  it('名称冲突交由弹窗处理，保留本地元数据', async () => {
    const { document } = setup()
    document.versions.value = [item(2)]
    mocks.renameVersion.mockRejectedValue({ statusCode: 409 })
    await expect(document.renameVersion(2, '仍在输入', 0)).rejects.toMatchObject({ statusCode: 409 })
    expect(document.versions.value[0]?.name).toBeNull()
  })
  it('切换工作区后，迟到改名与元数据响应均不能污染新工作区', async () => {
    const { document, navigate } = setup()
    document.versions.value = [item(2)]
    const rename = deferred<{ version: VersionMetadata }>()
    const refresh = deferred<ReturnType<typeof page>>()
    mocks.renameVersion.mockReturnValue(rename.promise)
    mocks.versionsPage.mockReturnValue(refresh.promise)
    const renaming = document.renameVersion(2, '旧工作区', 0)
    const refreshing = document.refreshVersionMetadata(2)
    navigate()
    rename.resolve({ version: item(2, 1, '旧工作区') })
    refresh.resolve(page([item(2, 1, '旧工作区')]))
    expect(await renaming).toBeNull()
    expect(await refreshing).toBeNull()
    expect(document.versions.value).toEqual([])
  })
})

describe('恢复服务端草稿', () => {
  it('使用用户比较过的修订号，恢复后重新读取当前行程、消息和版本列表', async () => {
    const reloadConversation = vi.fn()
    const document = createWorkspaceDocument({ navigation: () => 0, lifetime: () => 0, conversationId: () => 11,
      matchingConversation: () => 11, reloadConversation, rememberPlan: vi.fn(), errorMessage: ref('') })
    document.currentPlan.value = { id: 1, version: 8, revision: 20, plan: { title: '其他设备的新行程' } } as PlanDetail
    // A repeated successful recovery can refer to an older result; never put its snapshot into currentPlan.
    mocks.restoreDraft.mockResolvedValue({ version: 7, revision: 20, skipped: true })
    mocks.detail.mockResolvedValue({ id: 1, version: 8, revision: 20, plan: { title: '保持最新正式行程' } })
    mocks.versionsPage.mockResolvedValue(page([item(8), item(7)]))
    await document.restoreDraft(42, 5, 12)
    expect(mocks.restoreDraft).toHaveBeenCalledWith(1, 42, { expectedVersion: 5, expectedRevision: 12, conversationId: 11 })
    expect(document.currentPlan.value).toMatchObject({ version: 8, revision: 20 })
    expect(reloadConversation).toHaveBeenCalledOnce()
    expect(mocks.versionsPage).toHaveBeenCalledWith(1, undefined)
  })

  it('409 不刷新比较基线或自动重试，交由弹窗要求再次确认', async () => {
    const { document } = setup()
    mocks.restoreDraft.mockRejectedValue({ statusCode: 409 })
    await expect(document.restoreDraft(42, 5, 12)).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.restoreDraft).toHaveBeenCalledOnce()
    expect(mocks.detail).not.toHaveBeenCalled()
    expect(document.currentPlan.value).toMatchObject({ version: 5, revision: 12 })
  })

  it('切换工作区后的迟到恢复结果不刷新另一工作区', async () => {
    const { document, navigate } = setup()
    const result = deferred<{ version: number }>()
    mocks.restoreDraft.mockReturnValue(result.promise)
    const restoring = document.restoreDraft(42, 5, 12)
    navigate()
    result.resolve({ version: 6 })
    expect(await restoring).toBeNull()
    expect(mocks.detail).not.toHaveBeenCalled()
    expect(mocks.versionsPage).not.toHaveBeenCalled()
  })
})

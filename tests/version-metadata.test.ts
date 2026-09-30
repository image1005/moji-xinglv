import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../app/utils/api'
import { VersionMetadataSchema, VersionNameInputSchema, versionName } from '../app/utils/version-metadata'

const legacy = { id: 901, version: 3, source: 'user', parentVersionId: null, messageId: null, createdAt: '2026-09-30', diffJson: [] }
afterEach(() => vi.unstubAllGlobals())

describe('版本名称兼容边界', () => {
  it('缺失字段使用 null/null/0；展示版本号不使用数据库 ID', () => {
    const item = VersionMetadataSchema.parse(legacy)
    expect(item).toMatchObject({ name: null, nameSource: null, nameRevision: 0 })
    expect(versionName(item)).toBe('v3')
    expect(versionName({ ...item, name: '  江南慢游  ' })).toBe('江南慢游')
  })
  it('trim 后校验 1–40 字，含 Unicode，且不接受非法名称修订号', () => {
    expect(VersionNameInputSchema.parse({ name: '  山海  ', expectedNameRevision: 0 }).name).toBe('山海')
    expect(VersionNameInputSchema.safeParse({ name: ' ', expectedNameRevision: 0 }).success).toBe(false)
    expect(VersionNameInputSchema.safeParse({ name: '山'.repeat(41), expectedNameRevision: 0 }).success).toBe(false)
    expect(VersionNameInputSchema.safeParse({ name: '🏞'.repeat(40), expectedNameRevision: 0 }).success).toBe(true)
    expect(VersionNameInputSchema.safeParse({ name: '山海', expectedNameRevision: -1 }).success).toBe(false)
    for (const name of ['<b>山海</b>', '第一天\n第二天', '山\u200b海', '山\u0000海']) {
      expect(VersionNameInputSchema.safeParse({ name, expectedNameRevision: 0 }).success, name).toBe(false)
    }
  })
  it('列表解码保留服务端名称字段，改名 PATCH 使用展示版本号与独立锁', async () => {
    const named = { ...legacy, name: '江南慢游', nameSource: 'user', nameRevision: 2 }
    const fetcher = vi.fn().mockResolvedValueOnce({ items: [named], nextCursor: null, hasMore: false }).mockResolvedValueOnce({ version: named })
    vi.stubGlobal('$fetch', fetcher)
    expect((await api.plans.versionsPage(8)).items[0]).toEqual(named)
    expect((await api.plans.renameVersion(8, 3, { name: '  江南慢游 ', expectedNameRevision: 1 })).version).toEqual(named)
    expect(fetcher).toHaveBeenLastCalledWith('/api/plans/8/versions/3/name', { method: 'PATCH', body: { name: '江南慢游', expectedNameRevision: 1 } })
  })
})

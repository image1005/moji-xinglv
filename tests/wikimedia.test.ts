import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { acquireWikimediaImage } from '../server/services/wikimedia'
const cache = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../server/services/cache', () => ({
  getCachedJson: async (key: string) => cache.get(key), setCachedJson: async (key: string, value: unknown) => { cache.set(key, value) },
  getCachedBinary: async () => Buffer.from('already-decoded-fixture'), setCachedBinary: vi.fn(),
}))
const entity = { entityId: 'spot:id', entityType: 'spot' as const, name: '苏州拙政园', city: '苏州市', address: '', fingerprint: 'id' }
beforeEach(() => cache.clear())
afterEach(() => vi.unstubAllGlobals())
it('仅去掉当前城市前缀，并核验百科城市信息后取得有署名图片', async () => {
  const titles: string[] = []
  vi.stubGlobal('fetch', async (input: URL) => {
    const title = input.searchParams.get('titles')!; titles.push(title)
    if (input.hostname === 'commons.wikimedia.org') return Response.json({ query: { pages: { 1: { imageinfo: [{ url: 'https://upload.wikimedia.org/fixture.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:fixture.jpg', extmetadata: { Artist: { value: '作者' }, LicenseShortName: { value: 'CC BY' } } }] } } } })
    return Response.json({ query: { pages: { 1: { title, ...(title === '拙政园' ? { pageimage: 'fixture.jpg', extract: '位于苏州市的园林' } : {}) } } } })
  })
  const result = await acquireWikimediaImage(entity)
  expect(titles).toEqual(['苏州拙政园', '拙政园', 'File:fixture.jpg'])
  expect(result?.image).toMatchObject({ provider: 'Wikimedia Commons', attribution: '作者 · CC BY' })
})
it('不能用另一个城市的同名图片，显式重试绕过未找到缓存', async () => {
  const fetcher = vi.fn(async (input: URL) => Response.json({ query: { pages: { 1: { title: input.searchParams.get('titles'), pageimage: 'wrong.jpg', extract: '位于另一个城市' } } } }))
  vi.stubGlobal('fetch', fetcher)
  expect(await acquireWikimediaImage(entity)).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(await acquireWikimediaImage(entity)).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(await acquireWikimediaImage(entity, true)).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(4)
})

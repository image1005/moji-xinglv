import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { acquireWikimediaImage } from '../server/services/wikimedia'
import { imageFailure } from '../server/providers/media-errors'
import { createError } from 'h3'
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
  const fetcher = vi.fn(async (input: URL) => input.hostname === 'commons.wikimedia.org' ? Response.json({}) : Response.json({ query: { pages: { 1: { title: input.searchParams.get('titles') || '另一个城市的拙政园', pageimage: 'wrong.jpg', extract: '位于另一个城市' } } } }))
  vi.stubGlobal('fetch', fetcher)
  expect(await acquireWikimediaImage(entity)).toBeNull()
  const calls = fetcher.mock.calls.length
  expect(calls).toBeGreaterThan(0)
  expect(await acquireWikimediaImage(entity)).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(calls)
  expect(await acquireWikimediaImage(entity, true)).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(calls * 2)
})

const file = (name: string, description: string, categories = 'Cuisine of Shanxi') => ({
  title: `File:${name}.jpg`, imageinfo: [{ mime: 'image/jpeg', url: `https://upload.wikimedia.org/${encodeURIComponent(name)}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}.jpg`,
    extmetadata: { Artist: { value: '测试作者' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, ImageDescription: { value: description }, Categories: { value: categories } },
  }],
})
const pages = (...values: object[]) => Response.json({ query: { pages: Object.fromEntries(values.map((value, index) => [String(index), value])) } })

it.each([
  ['晋祠', '太原（晋源区）', '晋祠'],
  ['永祚寺（双塔寺）', '太原', '永祚寺'],
  ['太原（晋源区）', '太原（晋源区）', '太原'],
])('规范化 %s 的查询，不改用户名称、城市或稳定身份', async (name, city, title) => {
  const original = { ...entity, name, city, entityType: name.startsWith('太原') ? 'city' as const : 'spot' as const }
  const before = structuredClone(original)
  vi.stubGlobal('fetch', async (input: URL) => input.hostname === 'commons.wikimedia.org' ? pages(file('correct', '太原照片', 'Taiyuan'))
    : input.searchParams.get('titles') === title ? pages({ title, pageimage: 'correct.jpg', extract: '位于太原市晋源区' }) : pages({ title: input.searchParams.get('titles') || '', missing: '' }))
  expect((await acquireWikimediaImage(original))?.image.matchedName).toBe(title)
  expect(original).toEqual(before)
})

it('同名检索拒绝顺带提到太原的大同纯阳宫，选择太原的具体条目', async () => {
  vi.stubGlobal('fetch', async (input: URL) => {
    if (input.hostname === 'commons.wikimedia.org') return pages(file(input.searchParams.get('titles')!, '太原纯阳宫照片', 'Taiyuan'))
    if (input.searchParams.has('titles')) return pages({ title: '纯阳宫', pageprops: { disambiguation: '' } })
    return pages({ title: '大同纯阳宫', pageimage: 'wrong.jpg', extract: '位于大同市，与太原纯阳宫同属三宫' },
      { title: '纯阳宫 (太原)', pageimage: 'correct.jpg', extract: '位于太原市迎泽区' })
  })
  const image = await acquireWikimediaImage({ ...entity, name: '纯阳宫', city: '太原' })
  expect(image?.image.sourceUrl).toContain('correct')
  expect(image?.image.matchedName).toBe('纯阳宫 (太原)')
})

it('百科无条目时使用 Commons 菜品照片，拒绝过油肉拌面和票据', async () => {
  vi.stubGlobal('fetch', async (input: URL) => input.hostname === 'zh.wikipedia.org' ? Response.json({}) : pages(
    file('noodles', '过油肉拌面'), file('receipt', '过油肉', 'Receipts of China|Cuisine of Shanxi'), file('过油肉', '一盘过油肉'),
  ))
  const image = await acquireWikimediaImage({ ...entity, entityType: 'food', name: '过油肉', city: '太原' })
  expect(image?.image.sourceUrl).toContain(encodeURIComponent('过油肉'))
  expect(image?.image.kind).toBe('food_illustration')
})

it('组合游览只展示已匹配的具体地点，并保留城市消歧', async () => {
  vi.stubGlobal('fetch', async (input: URL) => input.hostname === 'zh.wikipedia.org' ? Response.json({}) : pages(
    file('wrong', '另一城市的钟楼街', 'Other city'), file('correct', '太原市迎泽区钟楼街之太原大字', 'Taiyuan'),
  ))
  const image = await acquireWikimediaImage({ ...entity, name: '钟楼街·柳巷', city: '太原' })
  expect(image?.image.matchedName).toBe('钟楼街')
  expect(image?.image.sourceUrl).toContain('correct')
})

it('菜名与医疗术语同名时不采用医疗器材图片', async () => {
  vi.stubGlobal('fetch', async (input: URL) => input.hostname === 'zh.wikipedia.org'
    ? pages({ title: '灌肠', extract: '一种医疗处理，与食物消化有关', pageimage: 'enema.jpg' })
    : pages(file('灌肠', '医疗器材', 'Enema')))
  expect(await acquireWikimediaImage({ ...entity, entityType: 'food', name: '灌肠（荞面）', city: '太原' })).toBeNull()
})

it('网络异常不会作为未匹配结果缓存，恢复网络后可以再查', async () => {
  const fetcher = vi.fn(async () => { throw new TypeError('private upstream details') })
  vi.stubGlobal('fetch', fetcher)
  await expect(acquireWikimediaImage(entity)).rejects.toThrow(TypeError)
  expect(cache.size).toBe(0)
  vi.stubGlobal('fetch', async () => Response.json({}))
  expect(await acquireWikimediaImage(entity)).toBeNull()
  expect(cache.size).toBe(1)
})

it('百科故障时仍可由独立图库查询取得真实匹配图片', async () => {
  vi.stubGlobal('fetch', async (input: URL) => {
    if (input.hostname === 'zh.wikipedia.org') throw new TypeError('network')
    return pages(file('过油肉', '山西过油肉'))
  })
  expect((await acquireWikimediaImage({ ...entity, entityType: 'food', name: '过油肉' }))?.image).toBeTruthy()
})

it('有界重试：API 返回错误时不会把它当成空查询成功', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ error: { code: 'ratelimited', info: 'private detail' } }))
  await expect(acquireWikimediaImage(entity)).rejects.toThrow('Media API')
  expect(cache.size).toBe(0)
})

it('图片错误分类区分超时、限流、网络及解析，不暴露上游原文', () => {
  expect(imageFailure(new DOMException('private url', 'TimeoutError')).code).toBe('timeout')
  expect(imageFailure(createError({ statusCode: 502, data: { providerStatus: 429 } })).code).toBe('rate_limited')
  expect(imageFailure(new TypeError('private url')).code).toBe('network')
  expect(imageFailure(new SyntaxError('private body')).code).toBe('invalid_response')
  expect(imageFailure(new Error('private body')).message).not.toContain('private')
})

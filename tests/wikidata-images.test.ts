import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { acquireWikidataImage } from '../server/services/wikidata-images'
import { imageFailure } from '../server/providers/media-errors'

const cache = vi.hoisted(() => ({ json: new Map<string, unknown>(), binary: new Map<string, Buffer>(), writes: vi.fn() }))
vi.mock('../server/services/cache', () => ({
  getCachedJson: async (key: string) => cache.json.get(key),
  setCachedJson: async (key: string, value: unknown, ttl: number) => { cache.json.set(key, value); cache.writes(value, ttl) },
  getCachedBinary: async (key: string) => cache.binary.get(key),
  setCachedBinary: async (key: string, value: Buffer) => { cache.binary.set(key, value) },
}))
const entity = { entityId: 'spot:jinci', entityType: 'spot' as const, name: '晋祠', city: '太原（晋源区）', address: '', fingerprint: 'unchanged' }
const statement = (value: string | { id: string }) => ({ mainsnak: { snaktype: 'value', datavalue: { value } } })
const candidate = (id = 'Q1', name = '晋祠', description = '中国山西省太原市的祠庙', filename = 'Jinci.jpg') => ({
  id, labels: { zh: { value: name } }, descriptions: { zh: { value: description } }, claims: { P18: [statement(filename)] },
})
const city = { ...candidate('Q10', '太原', '中国山西省的地级市', 'Taiyuan.jpg'), labels: { zh: { value: '太原' }, en: { value: 'Taiyuan' } }, claims: { P18: [statement('Taiyuan.jpg')], P31: [statement({ id: 'Q515' })] } }
let bytes: Buffer
beforeEach(async () => {
  cache.json.clear(); cache.binary.clear(); vi.clearAllMocks()
  bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#667744' } }).png().toBuffer()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function fixture(items: object[], options: { city?: boolean; image?: string; license?: boolean; badImage?: boolean } = {}) {
  const records = items as Array<{ id: string }>
  const fetcher = vi.fn(async (input: URL | string) => {
    const url = new URL(input)
    if (url.hostname === 'upload.wikimedia.org') return new Response(options.badImage ? '<html>not a photograph</html>' : bytes)
    if (url.hostname === 'commons.wikimedia.org') {
      const title = url.searchParams.get('titles')!
      return Response.json({ query: { pages: { 1: { title, imageinfo: [{
        url: options.image ?? `https://upload.wikimedia.org/${encodeURIComponent(title)}.jpg`, mime: 'image/jpeg',
        descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURI(title)}`,
        extmetadata: { Artist: { value: '<b>测试作者</b>' }, ...(options.license === false ? {} : { LicenseShortName: { value: 'CC BY-SA 4.0' } }) },
      }] } } } })
    }
    expect(url.origin + url.pathname).toBe('https://www.wikidata.org/w/api.php')
    if (url.searchParams.get('action') === 'wbsearchentities') {
      expect(url.searchParams.get('language')).toBe('zh')
      return Response.json({ search: url.searchParams.get('search') === '太原' ? options.city === false ? [] : [{ id: city.id }] : records.map(item => ({ id: item.id })) })
    }
    expect(url.searchParams.get('action')).toBe('wbgetentities')
    const values = options.city === false ? records : [...records, city]
    return Response.json({ entities: Object.fromEntries(values.map(item => [item.id, item])) })
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

it('从核实的实体 P18 取得 Commons 图片，真实解码并保留许可，不改变行程身份', async () => {
  const original = structuredClone(entity)
  const fetcher = fixture([candidate()])
  const timeout = vi.spyOn(AbortSignal, 'timeout')
  const result = await acquireWikidataImage(entity)
  expect(result?.image).toMatchObject({ provider: 'Wikidata · Wikimedia Commons', attribution: '测试作者 · CC BY-SA 4.0', matchedName: '晋祠', kind: 'place_photo' })
  expect(entity).toEqual(original)
  expect(timeout).toHaveBeenCalledWith(14_000)
  expect((await sharp(cache.binary.get(result!.cacheKey)!).metadata()).format).toBe('webp')
  expect(fetcher).toHaveBeenCalledWith(result?.originUrl, expect.objectContaining({ redirect: 'error' }))
  expect(cache.writes).toHaveBeenCalledWith(expect.objectContaining({ image: expect.any(Object) }), 86400)
  const count = fetcher.mock.calls.length
  expect(await acquireWikidataImage({ ...entity, entityId: 'spot:other-plan' })).toEqual(result)
  expect(fetcher).toHaveBeenCalledTimes(count)
})

it('不采用搜索首位的异地同名地点，拒绝仅顺带提及目标城市的描述', async () => {
  const fetcher = fixture([candidate('Q1', '晋祠', '位于大同市的祠庙，与太原晋祠类似', 'Wrong.jpg'), candidate('Q2')])
  const result = await acquireWikidataImage(entity)
  expect(result?.originUrl).toContain('Jinci')
  expect(fetcher.mock.calls.some(([input]) => String(input).includes('Wrong'))).toBe(false)
})

it('同城市同名且类型相同的两个地点仍有歧义，不读取首位候选图片', async () => {
  const fetcher = fixture([candidate('Q1'), candidate('Q2', '晋祠', '中国太原市另一处祠庙', 'Other.jpg')])
  expect(await acquireWikidataImage(entity)).toBeNull()
  expect(fetcher.mock.calls.some(([input]) => new URL(input).hostname === 'commons.wikimedia.org')).toBe(false)
})

it('组合景点中某个名称有歧义时，继续尝试唯一匹配的另一具体地点', async () => {
  const fetcher = fixture([
    candidate('Q1', '钟楼街', '太原市的街道', 'Ambiguous-one.jpg'),
    candidate('Q2', '钟楼街', '太原市另一条街道', 'Ambiguous-two.jpg'),
    candidate('Q3', '柳巷', '太原市的一条街道', 'Liuxiang.jpg'),
  ])
  const result = await acquireWikidataImage({ ...entity, name: '钟楼街·柳巷' })
  expect(result?.image.matchedName).toBe('柳巷')
  expect(result?.originUrl).toContain('Liuxiang')
  expect(fetcher.mock.calls.some(([input]) => String(input).includes('Ambiguous'))).toBe(false)
})

it('支持权威中文别名与城市英文标签，也可由 P131 直接证明行政归属', async () => {
  const value = { ...candidate('Q1', 'Jinci Temple', 'temple in Taiyuan, Shanxi, China'), aliases: { zh: [{ value: '晋祠' }] } }
  fixture([value])
  expect((await acquireWikidataImage(entity))?.image.matchedName).toBe('晋祠')
  cache.json.clear(); cache.binary.clear()
  fixture([{ ...value, descriptions: { en: { value: 'historic temple' } }, claims: { ...value.claims, P131: [statement({ id: 'Q10' })] } }])
  expect((await acquireWikidataImage(entity))?.image).toBeTruthy()
})

it('名称必须精确对应标签或别名，且不能缺少地点及城市证据', async () => {
  const fetcher = fixture([candidate('Q1', '晋祠博物馆旧址'), candidate('Q2', '晋祠', 'historic temple'), candidate('Q3', '晋祠', '太原市的一部小说')])
  expect(await acquireWikidataImage(entity)).toBeNull()
  expect(fetcher.mock.calls.some(([input]) => new URL(input).hostname === 'commons.wikimedia.org')).toBe(false)
})

it('拒绝消歧页、人物和医疗同名实体，仅接受明确菜品作为示意图', async () => {
  const values = [
    { ...candidate('Q1', '灌肠', '太原小吃及医疗处理的消歧义页'), claims: { P18: [statement('Bad.jpg')], P31: [statement({ id: 'Q4167410' })] } },
    candidate('Q2', '灌肠', '医疗处理和食物消化有关', 'Medical.jpg'),
    { ...candidate('Q3', '灌肠', '太原市的美食人物'), claims: { P31: [statement({ id: 'Q5' })], P18: [statement('Person.jpg')] } },
    candidate('Q4', '灌肠', '中国传统面食小吃', 'Dish.jpg'),
  ]
  const fetcher = fixture(values)
  const result = await acquireWikidataImage({ ...entity, entityType: 'food', name: '灌肠（荞面）' })
  expect(result?.image).toMatchObject({ kind: 'food_illustration', matchedName: '灌肠' })
  expect(result?.originUrl).toContain('Dish')
  expect(fetcher.mock.calls.some(([input]) => /Bad|Medical|Person/.test(String(input)))).toBe(false)
})

it('城市实体也可取图，组合景点只标记实际匹配的组成地点', async () => {
  fixture([], { city: true })
  expect((await acquireWikidataImage({ ...entity, entityType: 'city', name: entity.city }))?.image.matchedName).toBe('太原')
  fixture([candidate('Q2', '钟楼街', '太原市的一条历史街道', 'Street.jpg')])
  expect((await acquireWikidataImage({ ...entity, name: '钟楼街·柳巷' }))?.image.matchedName).toBe('钟楼街')
})

it('未匹配仅缓存十分钟，显式重试绕过空结果缓存', async () => {
  const fetcher = fixture([], { city: false })
  expect(await acquireWikidataImage(entity)).toBeNull()
  const count = fetcher.mock.calls.length
  expect(cache.writes).toHaveBeenCalledWith({ missing: true }, 600)
  expect(await acquireWikidataImage(entity)).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(count)
  expect(await acquireWikidataImage(entity, true)).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(count * 2)
})

it.each(['http://upload.wikimedia.org/image.jpg', 'https://upload.wikimedia.org.evil.org/image.jpg', 'https://127.0.0.1/image.jpg', 'https://user:pass@upload.wikimedia.org/image.jpg'])('拒绝不可信图片地址 %s', async (image) => {
  const fetcher = fixture([candidate()], { image })
  expect(await acquireWikidataImage(entity)).toBeNull()
  expect(fetcher.mock.calls.every(([input]) => ['www.wikidata.org', 'commons.wikimedia.org'].includes(new URL(input).hostname))).toBe(true)
})

it('无作者或许可的图片不可展示，伪图片解码失败不可缓存为空结果', async () => {
  fixture([candidate()], { license: false })
  expect(await acquireWikidataImage(entity)).toBeNull()
  cache.json.clear()
  fixture([candidate()], { badImage: true })
  await expect(acquireWikidataImage(entity)).rejects.toThrow()
  expect(cache.json.size).toBe(0)
})

it.each([
  () => new Response('upstream failed', { status: 503 }),
  () => Response.json({ error: { code: 'maxlag', info: 'private upstream message' } }),
  () => Response.json({ search: Array.from({ length: 6 }, (_, index) => ({ id: `Q${index + 1}` })) }),
  () => new Response('{}', { headers: { 'content-length': '1000001' } }),
])('API 故障与越界响应不写负缓存', async (response) => {
  vi.stubGlobal('fetch', vi.fn(async () => response()))
  await expect(acquireWikidataImage(entity)).rejects.toThrow()
  expect(cache.json.size).toBe(0)
})

it('遵从上层取消，不继续下载或写入空结果', async () => {
  const controller = new AbortController()
  const fetcher = vi.fn((_input: URL, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
  }))
  vi.stubGlobal('fetch', fetcher)
  const pending = acquireWikidataImage(entity, false, controller.signal)
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled())
  controller.abort(new DOMException('parent deadline', 'TimeoutError'))
  await expect(pending).rejects.toThrow('parent deadline')
  expect(cache.json.size).toBe(0)
  expect(imageFailure(controller.signal.reason).code).toBe('timeout')
})

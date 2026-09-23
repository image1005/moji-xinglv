import { describe, expect, it } from 'vitest'
import { FoodEntrySchema, PlanSchema, SpotSchema } from '../shared/schemas/plan'
import { StaticMapQuerySchema, PanoramaQuerySchema } from '../shared/schemas/map'
import { hasCoordinates, mapViewport, routeDistance, staticMapUrl } from '../shared/utils/routes'
import { applyMergePatch } from '../shared/utils/merge-patch'

const point = (lng: number, lat: number) => ({ ...SpotSchema.parse({ name: '地点', lng, lat }), lng, lat })

describe('兼容与旅行数据契约', () => {
  it('兼容旧行程并补齐食记清单与地点默认值', () => {
    const plan = PlanSchema.parse({ title: '江南', days: [{ spots: [{ name: '西湖', lng: 120.15, lat: 30.24 }] }] })
    expect(plan.foodJournal).toEqual([])
    expect(plan.checklist).toEqual([])
    expect(plan.days[0]?.spots[0]?.category).toBe('sight')
  })
  it('未知地点不伪造坐标', () => {
    const spot = SpotSchema.parse({ name: '待核实' })
    expect(spot.lng).toBeNull()
    expect(hasCoordinates(spot)).toBe(false)
    expect(SpotSchema.safeParse({ name: '缺少纬度', lng: 120 }).success).toBe(false)
  })
  it('接受零经纬度，拒绝越界与非有限坐标', () => {
    expect(hasCoordinates(point(0, 0))).toBe(true)
    expect(hasCoordinates({ lng: Infinity, lat: 20 })).toBe(false)
    expect(StaticMapQuerySchema.safeParse({ center: '190,91' }).success).toBe(false)
    expect(StaticMapQuerySchema.safeParse({ center: '120.15,30.24' }).success).toBe(true)
  })
  it('禁止负预算与恶意图片协议', () => {
    expect(PlanSchema.safeParse({ title: 'a', budget: { total: -1 } }).success).toBe(false)
    expect(PlanSchema.safeParse({ title: 'a', cover: 'javascript:alert(1)' }).success).toBe(false)
  })
  it('食记评分为0至5且ID唯一', () => {
    expect(FoodEntrySchema.safeParse({ id: 'a', name: '龙井虾仁', rating: 6 }).success).toBe(false)
    expect(PlanSchema.safeParse({ title: 'a', foodJournal: [{ id: 'x', name: 'a' }, { id: 'x', name: 'b' }] }).success).toBe(false)
  })
})

describe('路线与安全地图参数', () => {
  it('空点集没有虚构地图中心', () => { expect(mapViewport([])).toBeNull(); expect(staticMapUrl([])).toBe('') })
  it('相邻点直线距离和空点分段', () => {
    const a = point(120, 30), b = point(121, 30)
    expect(routeDistance([a, a])).toBe(0)
    expect(routeDistance([a, b])).toBeGreaterThan(90)
    expect(routeDistance([a, SpotSchema.parse({ name: '未知' }), b])).toBe(0)
  })
  it('跨城范围自动降低地图缩放', () => {
    expect(mapViewport([point(116, 39), point(121, 31)])!.zoom).toBeLessThan(mapViewport([point(120, 30)])!.zoom)
  })
  it('URL带编号、无密钥，并符合服务端schema', () => {
    const url = staticMapUrl([point(120, 30), point(120.02, 30.01)])
    expect(url).not.toContain('ak=')
    const params = new URL(url, 'http://localhost').searchParams
    const raw = Object.fromEntries(params)
    expect(StaticMapQuerySchema.safeParse({ ...raw, markers: params.getAll('markers'), paths: params.getAll('paths') }).success).toBe(true)
    expect(params.get('markerStyles')).toContain('m,1,0xA63A2F')
  })
  it('拒绝自定义远程图标及非法路径坐标', () => {
    expect(StaticMapQuerySchema.safeParse({ markerStyles: '-1,https://attacker/icon.png' }).success).toBe(false)
    expect(StaticMapQuerySchema.safeParse({ paths: ['120,30;999,90'] }).success).toBe(false)
    expect(PanoramaQuerySchema.safeParse({ location: '120,30', heading: 361 }).success).toBe(false)
  })
})

describe('patch信任边界', () => {
  it('拒绝原型注入，包括数组中的属性', () => {
    expect(() => applyMergePatch({}, JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow()
    expect(() => applyMergePatch({}, JSON.parse('{"days":[{"constructor":{}}]}'))).toThrow()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
  it('数组替换不污染原数组与patch', () => {
    const patch = { a: [{ x: 1 }] }
    const merged = applyMergePatch({ a: [{ x: 0 }] }, patch)
    merged.a[0]!.x = 2
    expect(patch.a[0]!.x).toBe(1)
  })
})

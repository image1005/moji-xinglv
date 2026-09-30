import { describe, expect, it } from 'vitest'
import { PlanResourceSchema, type PlanResource } from '../shared/schemas/media'
import { PlanSchema, type Plan } from '../shared/schemas/plan'
import { cityMapPlaces, groupMapPlaces } from '../shared/utils/city-map'

const plan = () => PlanSchema.parse({
  title: '城市地图验收',
  days: [
    { city: ' 杭州 ', spots: [{ id: 'unknown', name: '待定位' }, { id: 'west-lake', name: '西湖', address: '西湖区', time: '09:00', lng: 120.15, lat: 30.25 }, { id: 'bridge', name: '断桥', lng: 120.16, lat: 30.26 }] },
    { city: '苏州', spots: [{ id: 'suzhou', name: '平江路', lng: 120.63, lat: 31.32 }] },
    { city: '杭州', spots: [{ id: 'west-lake-again', name: '西湖', lng: 120.15, lat: 30.25 }] },
  ],
})

function resource(id: string, lng: number, lat: number): PlanResource {
  return PlanResourceSchema.parse({
    entityId: `spot:${id}`, entityType: 'spot', name: '可信地点', city: '杭州', status: 'ready', image: null, error: null,
    location: { lng, lat, coordinateSystem: 'bd09ll', provider: '测试定位', sourceUrl: 'https://example.org/location' },
  })
}

describe('城市地图地点身份与编号', () => {
  it('城市去除首尾空白，保留原天数、日内编号及未定位条目', () => {
    const places = cityMapPlaces(plan(), [], ' 杭州 ', null)
    expect(places.map(place => [place.dayIndex, place.spotIndex, place.label, place.name])).toEqual([
      [0, 0, '1', '待定位'], [0, 1, '2', '西湖'], [0, 2, '3', '断桥'], [2, 0, '1', '西湖'],
    ])
    expect(places[0]).toMatchObject({ lng: null, lat: null })
    expect(places[1]).toMatchObject({ address: '西湖区', time: '09:00' })
    expect(places.filter(place => place.lng !== null).map(place => place.label)).toEqual(['2', '3', '1'])
  })

  it('按行程原日索引筛选，不把同城第二天错认为行程第二天', () => {
    expect(cityMapPlaces(plan(), [], '杭州', 2)).toMatchObject([{ dayIndex: 2, spotIndex: 0, label: '1', name: '西湖' }])
    expect(cityMapPlaces(plan(), [], '杭州', 1)).toEqual([])
    expect(cityMapPlaces(plan(), [], '杭州', 9)).toEqual([])
  })

  it('跨天重名及历史重复或空 ID 仍具有不同的地图身份', () => {
    const value = plan()
    value.days[2]!.spots[0]!.id = value.days[0]!.spots[1]!.id
    value.days[0]!.spots[0]!.id = ''
    value.days[0]!.spots[2]!.id = ''
    const places = cityMapPlaces(value, [], '杭州', null)
    expect(new Set(places.map(place => place.key)).size).toBe(places.length)
    expect(places[1]!.key).toContain('west-lake')
    expect(places[3]!.key).toContain('west-lake')
  })

  it('优先使用实体匹配的可信资源坐标，不按名称关联，不改动原行程', () => {
    const value = plan()
    const resources = [resource('west-lake', 120.155, 30.255), resource('unknown', 120.14, 30.24)]
    const before = structuredClone(value)
    const places = cityMapPlaces(value, resources, '杭州', null)
    expect(places[0]).toMatchObject({ lng: 120.14, lat: 30.24 })
    expect(places[1]).toMatchObject({ lng: 120.155, lat: 30.255 })
    expect(places[3]).toMatchObject({ lng: 120.15, lat: 30.25 })
    expect(value).toEqual(before)
  })

  it('非景点资源与空 ID 资源不会误配到行程', () => {
    const value = plan()
    value.days[0]!.spots[0]!.id = ''
    const incorrect = { ...resource('west-lake', 119, 29), entityType: 'city' as const }
    const places = cityMapPlaces(value, [incorrect, resource('', 119, 29)], '杭州', 0)
    expect(places[0]).toMatchObject({ lng: null, lat: null })
    expect(places[1]).toMatchObject({ lng: 120.15, lat: 30.25 })
  })

  it('未知、缺一项、越界和非有限坐标均作为未定位保留，零坐标仍有效', () => {
    const value = plan()
    value.days[0]!.spots = [
      { ...value.days[0]!.spots[0]!, lng: null, lat: null },
      { ...value.days[0]!.spots[0]!, lng: 120, lat: null },
      { ...value.days[0]!.spots[0]!, lng: 181, lat: 30 },
      { ...value.days[0]!.spots[0]!, lng: 120, lat: 91 },
      { ...value.days[0]!.spots[0]!, lng: Number.NaN, lat: 30 },
      { ...value.days[0]!.spots[0]!, lng: 120, lat: Number.POSITIVE_INFINITY },
      { ...value.days[0]!.spots[0]!, lng: 0, lat: 0 },
    ] as Plan['days'][number]['spots']
    const places = cityMapPlaces(value, [], '杭州', 0)
    expect(places.slice(0, 6).map(place => [place.lng, place.lat])).toEqual(Array.from({ length: 6 }, () => [null, null]))
    expect(places[6]).toMatchObject({ lng: 0, lat: 0, label: '7' })
  })

  it('无效资源不覆盖有效原坐标，也不把未知地点伪装为已定位', () => {
    const invalid = resource('west-lake', 120, 30)
    invalid.location!.lng = Number.NaN
    const missing = resource('unknown', 120, 30)
    missing.location!.lat = 100
    const places = cityMapPlaces(plan(), [invalid, missing], '杭州', 0)
    expect(places[0]).toMatchObject({ lng: null, lat: null })
    expect(places[1]).toMatchObject({ lng: 120.15, lat: 30.25 })
  })
})

describe('地图屏幕标记分组', () => {
  it('同坐标跨天地点归为一个标记，每个行程条目仍可独立访问', () => {
    const places = cityMapPlaces(plan(), [], '杭州', null)
    const points = [{ place: places[1]!, x: 200, y: 150 }, { place: places[3]!, x: 200, y: 150 }]
    const before = structuredClone(points)
    const groups = groupMapPlaces(points)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: places[1]!.key, x: 200, y: 150, places: [places[1], places[3]] })
    expect(groups[0]!.places[0]).toBe(places[1])
    expect(groups[0]!.places[1]).toBe(places[3])
    expect(points).toEqual(before)
  })

  it('近点合并、远点独立，组和组内条目保持首次出现顺序', () => {
    const places = cityMapPlaces(plan(), [], '杭州', null)
    const points = [
      { place: places[0]!, x: 100, y: 100 },
      { place: places[1]!, x: 400, y: 200 },
      { place: places[2]!, x: 120, y: 120 },
      { place: places[3]!, x: 420, y: 220 },
    ]
    const groups = groupMapPlaces(points)
    expect(groups.map(group => group.places.map(place => place.key))).toEqual([[places[0]!.key, places[2]!.key], [places[1]!.key, places[3]!.key]])
    expect(groups.map(group => [group.x, group.y])).toEqual([[110, 110], [410, 210]])
    expect(groupMapPlaces(points)).toEqual(groups)
    expect(groupMapPlaces(points, 10)).toHaveLength(4)
  })

  it('空点集为空，零半径只合并完全相同的屏幕坐标', () => {
    expect(groupMapPlaces([])).toEqual([])
    const [first, second, third] = cityMapPlaces(plan(), [], '杭州', 0)
    const groups = groupMapPlaces([{ place: first!, x: 0, y: 0 }, { place: second!, x: 0, y: 0 }, { place: third!, x: 1, y: 0 }], 0)
    expect(groups.map(group => group.places.length)).toEqual([2, 1])
  })
})

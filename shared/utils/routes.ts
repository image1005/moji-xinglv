import type { Spot } from '../schemas/plan'

export type LocatedSpot = Spot & { lng: number; lat: number }
export function hasCoordinates(spot: Pick<Spot, 'lng' | 'lat'>): spot is LocatedSpot {
  return typeof spot.lng === 'number' && typeof spot.lat === 'number'
    && Number.isFinite(spot.lng) && Number.isFinite(spot.lat)
    && Math.abs(spot.lng) <= 180 && Math.abs(spot.lat) <= 90
}

/** 直线估算，仅供行程密度参考，不是导航里程。 */
export function distanceKm(a: LocatedSpot, b: LocatedSpot): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))))
}

export function routeDistance(spots: Spot[]): number {
  return spots.reduce((total, spot, index) => {
    const previous = spots[index - 1]
    return previous && hasCoordinates(previous) && hasCoordinates(spot) ? total + distanceKm(previous, spot) : total
  }, 0)
}

export function mapViewport(spots: LocatedSpot[]) {
  if (!spots.length) return null
  const lngs = spots.map((s) => s.lng)
  const lats = spots.map((s) => s.lat)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const span = Math.max(maxLng - minLng, (maxLat - minLat) * 1.65, 0.004)
  const zoom = Math.max(3, Math.min(17, Math.floor(Math.log2(650 / span))))
  return { center: `${((minLng + maxLng) / 2).toFixed(6)},${((minLat + maxLat) / 2).toFixed(6)}`, zoom }
}

export const markerLabels = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const MAP_PAGE_SIZE = 10

/** 官方静态图语法：markers 用 |，paths 点用 ;。分页控制 URL 长度及一字标号。 */
export function staticMapUrl(spots: LocatedSpot[], zoomOffset = 0): string {
  const viewport = mapViewport(spots)
  if (!viewport) return ''
  const points = spots.slice(0, MAP_PAGE_SIZE)
  const params = new URLSearchParams({
    center: viewport.center,
    zoom: String(Math.max(3, Math.min(18, viewport.zoom + zoomOffset))),
    width: '800', height: '480', scale: '1',
    markerStyles: points.map((_, i) => `m,${markerLabels[i]},0xA63A2F`).join('|'),
    pathStyles: '0x4A7264,4,0.85',
  })
  const positions = points.map((s) => `${s.lng.toFixed(5)},${s.lat.toFixed(5)}`)
  for (const position of positions) params.append('markers', position)
  // 一日内同页已定位地点的顺序连线，跨页不假装连续导航。
  if (positions.length > 1) params.append('paths', positions.join(';'))
  return `/api/staticmap?${params.toString()}`
}

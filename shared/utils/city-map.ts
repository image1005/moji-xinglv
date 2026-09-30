import type { PlanResource } from '../schemas/media'
import type { Plan } from '../schemas/plan'
import { hasCoordinates } from './routes'

export interface CityMapPlace {
  key: string
  name: string
  address: string
  time: string
  dayIndex: number
  spotIndex: number
  label: string
  lng: number | null
  lat: number | null
}

/** Keep itinerary positions before locating points, so an unknown location never renumbers a day. */
export function cityMapPlaces(plan: Plan, resources: PlanResource[], city: string, dayIndex: number | null): CityMapPlace[] {
  const locations = new Map(resources.filter(resource => resource.entityType === 'spot' && resource.location && hasCoordinates(resource.location))
    .map(resource => [resource.entityId, resource.location!]))
  const targetCity = city.trim()
  return plan.days.flatMap((day, index) => {
    if (day.city.trim() !== targetCity || dayIndex !== null && index !== dayIndex) return []
    return day.spots.map((spot, spotIndex) => {
      const resource = spot.id ? locations.get(`spot:${spot.id}`) : undefined
      const location = resource ?? (hasCoordinates(spot) ? spot : null)
      return {
        key: `${index}:${spotIndex}:${spot.id}`,
        name: spot.name,
        address: spot.address,
        time: spot.time,
        dayIndex: index,
        spotIndex,
        label: String(spotIndex + 1),
        lng: location?.lng ?? null,
        lat: location?.lat ?? null,
      }
    })
  })
}

/** Group screen markers without merging itinerary entries or changing their geographic coordinates. */
export function groupMapPlaces(points: Array<{ place: CityMapPlace; x: number; y: number }>, radius = 44) {
  const groups: Array<{ key: string; x: number; y: number; places: CityMapPlace[] }> = []
  const distance = Number.isFinite(radius) ? Math.max(0, radius) : 44
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    const group = groups.find(candidate => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= distance)
    if (!group) {
      groups.push({ key: point.place.key, x: point.x, y: point.y, places: [point.place] })
      continue
    }
    const count = group.places.length
    group.x = (group.x * count + point.x) / (count + 1)
    group.y = (group.y * count + point.y) / (count + 1)
    group.places.push(point.place)
  }
  return groups
}

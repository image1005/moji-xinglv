import type { Plan } from '../schemas/plan'

const normalized = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, '')
/** Stable non-secret identity. Never uses current array positions to attach media. */
function digest(text: string) {
  let a = 2166136261; let b = 5381
  for (const char of text) { const code = char.codePointAt(0)!; a = Math.imul(a ^ code, 16777619); b = Math.imul(b, 33) ^ code }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36)
}
const cityEntityId = (city: string) => `city-${digest(normalized(city))}`
export interface PlanEntity { entityId: string; entityType: 'spot' | 'food' | 'city'; name: string; city: string; address: string; fingerprint: string }
const identity = (city: string, name: string, address: string) => [city, name, address].map(normalized).join('|')

export function ensurePlanEntityIds(plan: Plan, previous?: Plan): Plan {
  const next = structuredClone(plan)
  const old = new Map<string, string[]>()
  for (const day of previous?.days ?? []) for (const spot of day.spots) {
    const key = identity(day.city, spot.name, spot.address)
    old.set(key, [...(old.get(key) ?? []), spot.id])
  }
  const used = new Set(next.days.flatMap(day => day.spots.map(spot => spot.id)).filter(Boolean))
  for (const day of next.days) for (const spot of day.spots) {
    if (spot.id) continue
    const key = identity(day.city, spot.name, spot.address)
    const matches = old.get(key) ?? []
    if (matches.length === 1 && matches[0] && !used.has(matches[0])) spot.id = matches[0]
    else {
      const base = `spot-${digest(key)}`
      let candidate = base; let duplicate = 1
      while (used.has(candidate)) candidate = `${base}-${duplicate++}`
      spot.id = candidate
    }
    used.add(spot.id)
  }
  return next
}

export function planEntities(plan: Plan): PlanEntity[] {
  const next = ensurePlanEntityIds(plan)
  const entities: PlanEntity[] = []
  const cityNames = new Set([...next.days.map(day => day.city), ...next.foodJournal.map(food => food.city)].map(city => city.trim()).filter(Boolean))
  for (const city of cityNames) entities.push({ entityId: cityEntityId(city), entityType: 'city', name: city, city, address: '', fingerprint: digest(identity(city, city, '')) })
  for (const day of next.days) for (const spot of day.spots) entities.push({ entityId: `spot:${spot.id}`, entityType: 'spot', name: spot.name, city: day.city, address: spot.address, fingerprint: digest(identity(day.city, spot.name, spot.address)) })
  for (const food of next.foodJournal) entities.push({ entityId: `food:${food.id}`, entityType: 'food', name: food.name, city: food.city, address: food.address, fingerprint: digest(identity(food.city, food.name, food.address)) })
  return entities
}

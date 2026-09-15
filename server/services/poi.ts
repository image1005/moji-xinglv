import { getPlanSnapshot } from './plan'
import { hasCoordinates } from '../../shared/utils/routes'

/** 不向第三方发送搜索：严格只查当前用户当前规划中的已知地点。 */
export async function searchPlanPlaces(userId: string, planId: number, query: string, region = '') {
  const { plan } = await getPlanSnapshot(userId, planId)
  const keyword = query.trim().toLocaleLowerCase()
  return plan.days.filter((day) => !region || day.city.includes(region))
    .flatMap((day) => day.spots.filter(hasCoordinates))
    .filter((spot) => `${spot.name} ${spot.address}`.toLocaleLowerCase().includes(keyword))
    .slice(0, 20)
    .map(({ name, address, lng, lat }) => ({ name, address, lng, lat }))
}

import { listPlans } from '../../services/plan'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return listPlans(user.id)
})

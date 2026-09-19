import { z } from 'zod'
import { getPlanResources } from '../../../services/media'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.coerce.number().int().positive() }).parse)
  return getPlanResources(user.id, id)
})

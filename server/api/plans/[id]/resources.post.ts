import { z } from 'zod'
import { ResourceRequestSchema } from '../../../../shared/schemas/media'
import { enrichPlanResources } from '../../../services/media'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.coerce.number().int().positive() }).parse)
  const input = await readValidatedBody(event, ResourceRequestSchema.parse)
  return enrichPlanResources(user.id, id, input.expectedRevision, input.entityId)
})

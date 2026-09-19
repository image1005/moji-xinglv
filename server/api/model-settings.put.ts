import { ModelConfigurationSchema } from '../../shared/schemas/model-config'
import { saveModelSettings } from '../services/model-settings'
import { requireUser } from '../utils/session'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  return saveModelSettings(user.id, await readValidatedBody(event, ModelConfigurationSchema.parse))
})

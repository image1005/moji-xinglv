import { getModelSettings } from '../services/model-settings'
import { requireUser } from '../utils/session'

export default defineEventHandler(async event => getModelSettings((await requireUser(event)).id))

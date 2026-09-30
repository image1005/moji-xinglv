import { RenameVersionSchema } from '../../../../../../shared/schemas/workspace'
import { renameVersion } from '../../../../../services/version-names'
import { requireUser } from '../../../../../utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  const version = Number(getRouterParam(event, 'version'))
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(version) || version <= 0) {
    throw createError({ statusCode: 400, statusMessage: '参数不合法' })
  }
  const body = await readValidatedBody(event, RenameVersionSchema.parse)
  return { version: renameVersion(user.id, id, version, body) }
})

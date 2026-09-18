import { AttachmentIdSchema } from '../../../shared/schemas/attachment'
import { removeAttachment } from '../../services/attachments'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const id = AttachmentIdSchema.safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 400, statusMessage: '附件 ID 无效' })
  return removeAttachment(user.id, id.data)
})

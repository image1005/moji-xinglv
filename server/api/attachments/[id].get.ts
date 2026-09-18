import { AttachmentIdSchema } from '../../../shared/schemas/attachment'
import { readAttachment } from '../../services/attachments'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const id = AttachmentIdSchema.safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 400, statusMessage: '附件 ID 无效' })
  const row = readAttachment(user.id, id.data)
  setHeader(event, 'Content-Type', row.mediaType)
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return send(event, row.content)
})

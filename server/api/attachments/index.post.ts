import { getRequestWebStream } from 'h3'
import { z } from 'zod'
import { ATTACHMENT_LIMITS } from '../../../shared/schemas/attachment'
import { createAttachment } from '../../services/attachments'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const limit = ATTACHMENT_LIMITS.bytes + 16_384
  if (Number(getHeader(event, 'content-length') || 0) > limit) throw createError({ statusCode: 413, statusMessage: '上传超过 5 MiB 限制' })
  const stream = getRequestWebStream(event)
  if (!stream) throw createError({ statusCode: 400, statusMessage: '缺少上传文件' })
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) { await reader.cancel(); throw createError({ statusCode: 413, statusMessage: '上传超过 5 MiB 限制' }) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let form: FormData
  try { form = await new Response(new Uint8Array(Buffer.concat(chunks)), { headers: { 'content-type': getHeader(event, 'content-type') || '' } }).formData() }
  catch { throw createError({ statusCode: 400, statusMessage: '无效的文件上传格式' }) }
  const files = form.getAll('file')
  const file = files[0]
  const planId = z.coerce.number().int().positive().safeParse(form.get('planId'))
  if (!planId.success || files.length !== 1 || !(file instanceof File) || [...form.keys()].length !== 2) throw createError({ statusCode: 400, statusMessage: '请提交一个 file 图片及 planId' })
  return createAttachment(user.id, planId.data, file.name, Buffer.from(await file.arrayBuffer()))
})

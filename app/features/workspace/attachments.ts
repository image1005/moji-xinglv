import { reactive, ref } from 'vue'
import { ATTACHMENT_LIMITS, AttachmentSchema, type Attachment } from '#shared/schemas/attachment'
import { apiErrorMessage } from '~/utils/api'

interface AttachmentDraft {
  key: string; planId: number; file: File; preview: string; progress: number
  status: 'uploading' | 'ready' | 'error'; error: string; attachment?: Attachment
}

/** Binary uploads are separate from chat. Drafts and object URLs belong to this workspace instance. */
export function createAttachmentDrafts() {
  const drafts = reactive<Record<string, AttachmentDraft[]>>({})
  const failure = ref('')
  const uploads = new Map<string, XMLHttpRequest>()
  let generation = 0

  async function upload(entry: AttachmentDraft) {
    const epoch = generation
    entry.status = 'uploading'
    entry.error = ''
    entry.progress = 0
    try {
      const attachment = await new Promise<Attachment>((resolve, reject) => {
        const request = new XMLHttpRequest()
        uploads.set(entry.key, request)
        request.open('POST', '/api/attachments')
        request.timeout = 120_000
        request.upload.onprogress = event => { if (event.lengthComputable) entry.progress = Math.round(event.loaded / event.total * 100) }
        request.onerror = () => reject(new Error('上传网络中断，请重试'))
        request.ontimeout = () => reject(new Error('上传超时，请重试'))
        request.onabort = () => reject(new Error('上传已取消'))
        request.onload = () => {
          try {
            const body: unknown = JSON.parse(request.responseText)
            if (request.status < 200 || request.status >= 300) throw body
            resolve(AttachmentSchema.parse(body))
          } catch (error) { reject(error) }
        }
        const body = new FormData()
        body.append('planId', String(entry.planId))
        body.append('file', entry.file)
        request.send(body)
      })
      if (generation !== epoch || !uploads.has(entry.key)) return
      entry.attachment = attachment
      entry.status = 'ready'
      entry.progress = 100
    } catch (error) {
      if (generation === epoch && uploads.has(entry.key)) {
        entry.error = apiErrorMessage(error, '图片上传失败，请重试')
        entry.status = 'error'
      }
    } finally { uploads.delete(entry.key) }
  }

  function add(scope: string, planId: number, files: File[]) {
    failure.value = ''
    const entries = drafts[scope] ??= []
    for (const file of files) {
      if (entries.length >= ATTACHMENT_LIMITS.count) { failure.value = `每轮最多 ${ATTACHMENT_LIMITS.count} 张图片`; break }
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > ATTACHMENT_LIMITS.bytes || !file.size) {
        failure.value = '图片须为 JPEG、PNG 或 WebP，每张不超过 5 MiB'
        continue
      }
      const entry = reactive<AttachmentDraft>({ key: crypto.randomUUID(), planId, file, preview: URL.createObjectURL(file), progress: 0, status: 'uploading', error: '' })
      entries.push(entry)
      void upload(entry)
    }
  }

  function remove(scope: string, key: string, consumed = false) {
    const entry = drafts[scope]?.find(item => item.key === key)
    if (!entry) return
    uploads.get(key)?.abort()
    uploads.delete(key)
    URL.revokeObjectURL(entry.preview)
    drafts[scope] = drafts[scope]!.filter(item => item.key !== key)
    if (entry.attachment && !consumed) {
      void $fetch(`/api/attachments/${entry.attachment.id}`, { method: 'DELETE' }).catch(() => { /* Bound history attachments are retained by the server. */ })
    }
  }

  function consume(scope: string, keys: string[]) { for (const key of keys) remove(scope, key, true) }
  function retry(scope: string, key: string) {
    const entry = drafts[scope]?.find(item => item.key === key)
    if (entry?.status === 'error') void upload(entry)
  }
  function reset() {
    generation++
    for (const request of uploads.values()) request.abort()
    uploads.clear()
    for (const [scope, entries] of Object.entries(drafts)) {
      for (const entry of entries) URL.revokeObjectURL(entry.preview)
      Reflect.deleteProperty(drafts, scope)
    }
    failure.value = ''
  }
  return { drafts, failure, add, remove, consume, retry, reset }
}

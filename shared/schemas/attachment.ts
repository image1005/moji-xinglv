import { z } from 'zod'

export const ATTACHMENT_LIMITS = { count: 4, bytes: 5 * 1024 * 1024, pixels: 24_000_000, dimension: 8192 } as const
export const AttachmentIdSchema = z.string().uuid()
export const AttachmentSchema = z.strictObject({
  id: AttachmentIdSchema, url: z.string().regex(/^\/api\/attachments\/[a-f0-9-]+$/),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']), filename: z.string().max(200),
  size: z.number().int().positive(), width: z.number().int().positive(), height: z.number().int().positive(),
})
export type Attachment = z.infer<typeof AttachmentSchema>

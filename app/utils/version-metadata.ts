import { z } from 'zod'
import { RenameVersionSchema, VersionSchema, type VersionItem } from '#shared/schemas/workspace'

// Frontend compatibility boundary while the shared backend contract is merged separately.
export const VersionMetadataSchema = VersionSchema.extend({
  name: z.string().nullable().default(null),
  nameSource: z.enum(['ai', 'user', 'fallback']).nullable().default(null),
  nameRevision: z.number().int().nonnegative().default(0),
})
export type VersionMetadata = VersionItem & z.infer<typeof VersionMetadataSchema>

export const VersionNameInputSchema = RenameVersionSchema

export function versionName(item: { version: number; name?: string | null }) {
  return item.name?.trim() || `v${item.version}`
}

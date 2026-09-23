import { z } from 'zod'

const ResourceImageSchema = z.strictObject({
  url: z.string(), sourceUrl: z.url(), provider: z.string(), attribution: z.string(),
  kind: z.enum(['place_photo', 'food_illustration']),
  matchedName: z.string().max(200).optional(),
})
const ResourceLocationSchema = z.strictObject({
  lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90),
  coordinateSystem: z.literal('bd09ll'), provider: z.string(), sourceUrl: z.url(),
})
export const PlanResourceSchema = z.strictObject({
  entityId: z.string(), entityType: z.enum(['spot', 'food', 'city']), name: z.string(), city: z.string(),
  status: z.enum(['pending', 'ready', 'failed', 'not_found']),
  image: ResourceImageSchema.nullable(), location: ResourceLocationSchema.nullable(), error: z.string().nullable(),
  imageIssue: z.strictObject({
    code: z.enum(['no_match', 'timeout', 'rate_limited', 'network', 'invalid_response', 'unavailable', 'configuration']),
    message: z.string().max(300),
  }).nullable().optional(),
})
export const PlanResourcesSchema = z.strictObject({ revision: z.number().int(), resources: z.array(PlanResourceSchema) })
export const ResourceRequestSchema = z.strictObject({ expectedRevision: z.number().int().positive(), entityId: z.string().max(110).optional() })
export type ResourceImage = z.infer<typeof ResourceImageSchema>
export type ResourceLocation = z.infer<typeof ResourceLocationSchema>
export type PlanResource = z.infer<typeof PlanResourceSchema>
export type PlanResources = z.infer<typeof PlanResourcesSchema>

import { z } from 'zod'

const ThinkingLevelSchema = z.enum(['off', 'light', 'standard', 'deep'])
export const ModelConfigurationSchema = z.strictObject({
  model: z.string().min(1).max(120), webSearch: z.boolean().default(false), thinking: ThinkingLevelSchema.default('off'),
})
export type ModelConfiguration = z.infer<typeof ModelConfigurationSchema>
const ModelCapabilitiesSchema = z.strictObject({
  model: z.string(), provider: z.string(), vision: z.boolean(), tools: z.boolean(),
  thinkingLevels: z.array(ThinkingLevelSchema),
  search: z.strictObject({ available: z.boolean(), provider: z.string().nullable(), native: z.literal(false) }),
  verification: z.enum(['documented', 'configured']),
})
export const ModelSettingsSchema = z.strictObject({ defaults: ModelConfigurationSchema, capabilities: ModelCapabilitiesSchema })
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>
export const SearchSourceSchema = z.strictObject({
  title: z.string().max(300), url: z.url().max(2048), summary: z.string().max(1200),
  fetchedAt: z.iso.datetime(), provider: z.literal('Tavily'),
})
export type SearchSource = z.infer<typeof SearchSourceSchema>

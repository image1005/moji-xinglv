import { z } from 'zod'

export const PlanPreviewSchema = z.object({
  planId: z.number().int().positive(), version: z.number().int().nonnegative(),
  title: z.string(), summary: z.string(), cover: z.string(),
  days: z.array(z.object({ date: z.string(), city: z.string(), spots: z.array(z.object({ id: z.string().optional(), name: z.string(), time: z.string(), panorama: z.string() })) })),
  foodJournal: z.array(z.object({ id: z.string(), name: z.string(), city: z.string() })).optional(),
  source: z.enum(['ai', 'user', 'rollback']), message: z.string().optional(),
})

export const PlanMutationResultSchema = z.object({
  ok: z.literal(true), version: z.number().int().nonnegative(),
  revision: z.number().int().positive().optional(),
  versionId: z.number().int().positive().nullable(), preview: PlanPreviewSchema,
  changed: z.number().int().nonnegative().optional(), skipped: z.boolean().optional(),
})

export type PlanPreview = z.infer<typeof PlanPreviewSchema>

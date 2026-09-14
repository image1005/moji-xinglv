import { z } from 'zod'

/** 行程 JSON 的唯一 Zod schema 与类型来源（PRD §5） */

export const SpotSchema = z.object({
  name: z.string().min(1),
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  time: z.string().default(''),
  notes: z.string().default(''),
  imageUrl: z.string().default(''),
  panorama: z.string().default(''),
})

export const DaySchema = z.object({
  date: z.string().default(''),
  city: z.string().default(''),
  spots: z.array(SpotSchema).default([]),
  transport: z.string().default(''),
  lodging: z.string().default(''),
  meals: z.array(z.string()).default([]),
})

export const BudgetSchema = z.object({
  total: z.number().default(0),
  currency: z.string().default('CNY'),
  breakdown: z.record(z.string(), z.number()).optional(),
})

export const PlanSchema = z.object({
  title: z.string().min(1),
  summary: z.string().default(''),
  cover: z.string().default(''),
  days: z.array(DaySchema).default([]),
  tips: z.array(z.string()).default([]),
  budget: BudgetSchema.default({ total: 0, currency: 'CNY' }),
  tags: z.array(z.string()).default([]),
})

export type Spot = z.infer<typeof SpotSchema>
export type Day = z.infer<typeof DaySchema>
export type Budget = z.infer<typeof BudgetSchema>
export type Plan = z.infer<typeof PlanSchema>

export function emptyPlan(title = '未命名行程'): Plan {
  return PlanSchema.parse({ title })
}

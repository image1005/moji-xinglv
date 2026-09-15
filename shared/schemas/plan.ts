import { z } from 'zod'

/** 唯一数据契约。新增字段提供默认值，历史 JSON 无需破坏性迁移。 */
const shortText = z.string().max(200)
const note = z.string().max(4000)
const imageUrl = z.string().max(2048).refine(
  (value) => value === '' || /^https:\/\//i.test(value) || /^\/api\/(panorama|staticmap)\?/.test(value),
  '图片须为 HTTPS 地址或本站地图代理地址',
)

export const SpotSchema = z.strictObject({
  name: shortText.min(1),
  lng: z.number().min(-180).max(180).nullable().default(null),
  lat: z.number().min(-90).max(90).nullable().default(null),
  time: z.string().max(80).default(''),
  notes: note.default(''),
  imageUrl: imageUrl.default(''),
  panorama: imageUrl.default(''),
  address: z.string().max(500).default(''),
  category: z.enum(['sight', 'food', 'stay', 'transport']).default('sight'),
  durationMinutes: z.number().int().min(0).max(1440).default(60),
  cost: z.number().min(0).max(10000000).default(0),
}).refine((spot) => (spot.lng === null) === (spot.lat === null), {
  message: '经纬度须同时提供，未知坐标请同时留空', path: ['lat'],
})

export const DaySchema = z.strictObject({
  date: z.string().max(32).default(''),
  city: shortText.default(''),
  spots: z.array(SpotSchema).max(50).default([]),
  transport: note.default(''),
  lodging: note.default(''),
  meals: z.array(shortText).max(20).default([]),
})

export const BudgetSchema = z.strictObject({
  total: z.number().min(0).max(100000000).default(0),
  currency: z.string().regex(/^[A-Z]{3}$/).default('CNY'),
  breakdown: z.record(z.string().max(80), z.number().min(0).max(100000000)).optional(),
})

export const FoodEntrySchema = z.strictObject({
  id: z.string().min(1).max(100),
  name: shortText.min(1),
  restaurant: shortText.default(''),
  city: shortText.default(''),
  address: z.string().max(500).default(''),
  date: z.string().max(32).default(''),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).default('snack'),
  status: z.enum(['wishlist', 'tasted']).default('wishlist'),
  cost: z.number().min(0).max(1000000).default(0),
  rating: z.number().int().min(0).max(5).default(0),
  notes: note.default(''),
  tags: z.array(z.string().max(40)).max(12).default([]),
})

export const ChecklistItemSchema = z.strictObject({
  id: z.string().min(1).max(100),
  text: shortText.min(1),
  done: z.boolean().default(false),
})

export const PlanSchema = z.strictObject({
  title: shortText.min(1),
  summary: note.default(''),
  cover: imageUrl.default(''),
  days: z.array(DaySchema).max(90).default([]),
  tips: z.array(note).max(100).default([]),
  budget: BudgetSchema.default({ total: 0, currency: 'CNY' }),
  tags: z.array(z.string().max(40)).max(30).default([]),
  foodJournal: z.array(FoodEntrySchema).max(300).default([]),
  checklist: z.array(ChecklistItemSchema).max(100).default([]),
}).superRefine((plan, ctx) => {
  for (const field of ['foodJournal', 'checklist'] as const) {
    const ids = new Set<string>()
    plan[field].forEach((entry, index) => {
      if (ids.has(entry.id)) ctx.addIssue({ code: 'custom', message: '条目 ID 不可重复', path: [field, index, 'id'] })
      ids.add(entry.id)
    })
  }
})

export type Spot = z.infer<typeof SpotSchema>
export type Day = z.infer<typeof DaySchema>
export type Budget = z.infer<typeof BudgetSchema>
export type FoodEntry = z.infer<typeof FoodEntrySchema>
export type Plan = z.infer<typeof PlanSchema>

export function emptyPlan(title = '未命名行程'): Plan {
  return PlanSchema.parse({ title })
}

/** 未知字段不再静默丢弃：给出改名建议，让 AI 与用户都能立即修正。 */
const UNKNOWN_KEY_HINTS: Record<string, string> = {
  stay: '住宿请改用 lodging',
  duration: '停留时长请改用 durationMinutes（分钟数，如 90）',
  id: '该对象不支持 id，请删除',
  day: 'days 数组顺序即天数，无需 day 字段',
  theme: '该对象不支持 theme，可写入 summary 或该日 city',
  title: '仅行程顶层支持 title',
  notes: '该对象不支持 notes：景点用 notes，行程用 tips',
  tips: '行程提示请写入顶层 tips 数组',
  planId: 'planId 由工具参数传递，不要写入 patch',
  rating: '评分请用 0–5 的数字，未评分填 0',
  breakdown: 'breakdown 须为 { "分类": 金额 } 对象',
}

function issueParts(issue: z.core.$ZodIssue): { message: string; hint: string } {
  const path = issue.path.map(String)
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys
    return {
      message: `未知字段 ${keys.join('、')}`,
      hint: keys.map((key) => UNKNOWN_KEY_HINTS[key] ?? `${key} 不是受支持字段，请删除`).join('；'),
    }
  }
  if (issue.code === 'invalid_type') {
    if (path.at(-1) === 'rating') return { message: issue.message, hint: '未评分请填 0，不要用 null' }
    if (path.at(-1) === 'breakdown') return { message: issue.message, hint: 'breakdown 须为 { "分类": 金额 } 对象' }
  }
  return { message: issue.message, hint: '' }
}

/** 服务端与客户端共用：路径 + 原因 + 可操作建议。 */
export function formatPlanIssues(issues: readonly z.core.$ZodIssue[], limit = 6): string {
  return issues.slice(0, limit).map((issue) => {
    const path = issue.path.map(String).join('.') || '$'
    const { message, hint } = issueParts(issue)
    return `${path}: ${message}${hint ? `（${hint}）` : ''}`
  }).join('；')
}

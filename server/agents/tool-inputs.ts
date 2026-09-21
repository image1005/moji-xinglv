import { z } from 'zod'
import { formatPlanIssues } from '../../shared/schemas/plan'

const planId = z.number().int().positive().describe('必填：当前工作区的 planId，见系统提示。不能省略或使用其他规划 ID。')
const expectedVersion = z.number().int().nonnegative().optional()
  .describe('可选：最后读取的当前版本号。只有版本冲突时才需要 get_plan 重读。')
const editValue = z.record(z.string(), z.unknown()).describe(
  '当前目标对象的部分字段，保持字段类型：景点 category 只能 sight/food/stay/transport（可省略，默认 sight），cost 为数字；日程 meals 为字符串数组；食记 meal 只能是 breakfast/lunch/dinner/snack，status 只能是 wishlist/tasted，rating 是 0–5 整数。新增清单的 text 放在操作顶层，不能放进 value。长行程每批最多两天，成功后继续下一批。',
)
const editOp = z.strictObject({
  target: z.enum(['plan', 'day', 'spot', 'food', 'checklist']),
  action: z.enum(['add', 'update', 'remove', 'move', 'status', 'toggle']),
  day: z.number().int().min(0).max(500).optional().describe('操作景点时必填：所属 days 数组下标，从 0 开始。'),
  index: z.number().int().min(0).max(1000).optional().describe('修改、删除或移动日程/景点时的数组下标，从 0 开始。'),
  to: z.number().int().min(0).max(1000).optional(),
  id: z.string().min(1).max(100).optional().describe('修改已有食记或清单时使用该条目的已有 ID。'),
  text: z.string().min(1).max(200).optional().describe('新增 checklist 时必填，直接放在本项操作顶层，与 target/action 同级。'),
  status: z.enum(['wishlist', 'tasted']).optional(),
  value: editValue.optional(),
})

/** 工具执行与聊天边界使用同一份入参契约，避免把框架校验结果误当作成功输出。 */
export const PLAN_TOOL_INPUT_SCHEMAS = {
  search_web: z.strictObject({ planId, query: z.string().trim().min(1).max(200) }),
  get_plan: z.strictObject({
    planId,
    section: z.enum(['all', 'overview', 'metadata', 'budget', 'tips', 'day', 'foodJournal', 'checklist']).optional(),
    dayIndex: z.number().int().min(0).max(499).optional(),
    offset: z.number().int().min(0).max(10000).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  apply_plan_edits: z.strictObject({
    planId,
    edits: z.array(editOp).min(1).max(30).describe('必填：1–30 项编辑，按顺序执行。参数不能是空对象。'),
    expectedVersion,
  }),
  patch_plan_json: z.strictObject({
    planId,
    patch: z.record(z.string(), z.unknown()),
    reason: z.string().max(300).optional(),
    expectedVersion,
  }),
  get_panorama: z.strictObject({
    planId,
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    heading: z.number().min(0).max(360).optional(),
    fov: z.number().min(10).max(360).optional(),
  }),
  search_poi: z.strictObject({
    planId,
    query: z.string().min(1).max(60),
    region: z.string().max(30).default(''),
  }),
}

/** 只基于本地契约重建提示，不展示框架附带原始参数的 validation message。 */
export function toolInputError(name: unknown, input: unknown): string | null {
  if (typeof name !== 'string' || !Object.hasOwn(PLAN_TOOL_INPUT_SCHEMAS, name)) return null
  const schema = PLAN_TOOL_INPUT_SCHEMAS[name as keyof typeof PLAN_TOOL_INPUT_SCHEMAS]
  const result = schema.safeParse(input)
  return result.success ? null : `工具参数校验失败（${formatPlanIssues(result.error.issues)}）。请按工具参数要求重新调用。`
}

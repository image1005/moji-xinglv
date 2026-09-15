import { createTool } from '@mastra/core/tools'
import { createError } from 'h3'
import { z } from 'zod'
import { PlanSchema } from '../../shared/schemas/plan'
import { PlanMutationResultSchema } from '../../shared/schemas/preview'
import { getPanoramaImage } from '../services/baidu'
import { applyPlanEdits, getPlanSnapshot, patchPlan } from '../services/plan'
import { searchPlanPlaces } from '../services/poi'
import { actionableMessage, isAbortError, markActionable } from '../utils/errors'

export interface ToolContext {
  userId: string; planId: number; conversationId: number; assistantMessageId: number
  signal?: AbortSignal
}
const scope = z.number().int().positive()
const mutationOutput = PlanMutationResultSchema
const editValue = z.record(z.string(), z.unknown())
const editOp = z.strictObject({
  target: z.enum(['plan', 'day', 'spot', 'food', 'checklist']),
  action: z.enum(['add', 'update', 'remove', 'move', 'status', 'toggle']),
  day: z.number().int().min(0).max(500).optional(),
  index: z.number().int().min(0).max(1000).optional(),
  to: z.number().int().min(0).max(1000).optional(),
  id: z.string().min(1).max(100).optional(),
  text: z.string().min(1).max(200).optional(),
  status: z.enum(['wishlist', 'tasted']).optional(),
  value: editValue.optional(),
})

export function createPlanTools(ctx: ToolContext) {
  function ensureScope(planId: number) {
    ctx.signal?.throwIfAborted()
    if (planId !== ctx.planId) {
      throw createError({ statusCode: 400, statusMessage: '工具只能访问当前工作区，请使用当前 planId' })
    }
  }
  /** 只有我们自己产生的 4xx/5xx 文案才透传给用户；未知错误交回上层统一替换。 */
  async function guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      if (isAbortError(error)) throw error
      const message = actionableMessage(error)
      if (message) throw markActionable(message)
      throw error
    }
  }
  const getPlan = createTool({
    id: 'get_plan', description: '读取当前规划 JSON 与当前版本。编辑前不必读取；仅在版本冲突（409）后需要重读。',
    inputSchema: z.strictObject({ planId: scope }),
    outputSchema: z.object({ ok: z.literal(true), planId: scope, version: z.number().int(), plan: PlanSchema }),
    execute: ({ planId }) => guard(async () => {
      ensureScope(planId)
      const { plan, current } = await getPlanSnapshot(ctx.userId, planId)
      return { ok: true as const, planId, version: current?.version ?? 0, plan }
    }),
  })
  const apply = createTool({
    id: 'apply_plan_edits',
    description: '原子编辑当前行程：按顺序应用操作数组。每项 { target: plan|day|spot|food|checklist, action: add|update|remove|move|status|toggle, day?, index?, to?, id?, text?, status?, value? }；value 为该对象的部分字段（数组整体替换、null 删除字段）。示例：[{"target":"spot","action":"add","day":0,"value":{"name":"断桥残雪","durationMinutes":90}},{"target":"checklist","action":"add","text":"预约门票"}]。工具直接作用于最新内容，不必先读取；返回版本冲突(409)时先用 get_plan 重读再重试。',
    inputSchema: z.strictObject({
      planId: scope,
      edits: z.array(editOp).min(1).max(30),
      expectedVersion: z.number().int().nonnegative().optional(),
    }),
    outputSchema: mutationOutput,
    execute: (input) => guard(async () => {
      ensureScope(input.planId)
      const result = await applyPlanEdits(ctx.userId, ctx.planId, input.edits, {
        messageId: ctx.assistantMessageId, expectedVersion: input.expectedVersion,
      })
      return {
        ok: true as const,
        version: result.version,
        versionId: result.versionId,
        changed: result.diff.length,
        skipped: result.skipped,
        preview: result.preview,
      }
    }),
  })
  const patch = createTool({
    id: 'patch_plan_json',
    description: '兜底工具：仅当 apply_plan_edits 无法表达时使用。提交 RFC7396 增量 patch（对象合并、数组整体替换、null 删除字段）。字段名必须与契约一致：行程顶层 title/summary/cover/days/tips/budget/tags/foodJournal/checklist；days 项 date/city/spots/transport/lodging/meals；景点 name/lng/lat/time/notes/imageUrl/panorama/address/category/durationMinutes(分钟数)/cost；食记 id/name/restaurant/city/address/date/meal/status/cost/rating/notes/tags；清单 id/text/done。自造字段会被服务端拒绝。',
    inputSchema: z.strictObject({
      planId: scope,
      patch: z.record(z.string(), z.unknown()),
      reason: z.string().max(300).optional(),
      expectedVersion: z.number().int().nonnegative().optional(),
    }),
    outputSchema: mutationOutput,
    execute: (input) => guard(async () => {
      ensureScope(input.planId)
      const result = await patchPlan(ctx.userId, ctx.planId, input.patch, {
        source: 'ai', messageId: ctx.assistantMessageId, expectedVersion: input.expectedVersion, note: input.reason,
      })
      return {
        ok: true as const,
        version: result.version,
        versionId: result.versionId,
        changed: result.diff.length,
        preview: result.preview,
      }
    }),
  })
  const panorama = createTool({
    id: 'get_panorama', description: '获取已知 BD09 坐标的街景代理 URL。不得猜测坐标，失败保留空街景。',
    inputSchema: z.strictObject({ planId: scope, lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90), heading: z.number().min(0).max(360).optional(), fov: z.number().min(10).max(360).optional() }),
    outputSchema: z.object({ ok: z.boolean(), url: z.string(), message: z.string().optional() }),
    execute: ({ planId, lng, lat, heading, fov }) => guard(async () => {
      ensureScope(planId)
      await getPlanSnapshot(ctx.userId, planId)
      const query = new URLSearchParams({ location: `${lng},${lat}`, width: '640', height: '360' })
      if (heading !== undefined) query.set('heading', String(heading))
      if (fov !== undefined) query.set('fov', String(fov))
      try {
        await getPanoramaImage({ location: `${lng},${lat}`, width: 640, height: 360, heading, fov })
        return { ok: true, url: `/api/panorama?${query.toString()}` }
      } catch { return { ok: false, url: '', message: '该位置街景暂不可用，请保留空值并提示用户核实。' } }
    }),
  })
  const places = createTool({
    id: 'search_poi', description: '仅检索当前规划中已有的已定位地点，不是联网搜索。无结果时坐标保留null，请用户在路线舆图中补全。',
    inputSchema: z.strictObject({ planId: scope, query: z.string().min(1).max(60), region: z.string().max(30).default('') }),
    outputSchema: z.object({ ok: z.literal(true), source: z.literal('current-plan'), results: z.array(z.object({ name: z.string(), address: z.string(), lng: z.number(), lat: z.number() })) }),
    execute: ({ planId, query, region }) => guard(async () => {
      ensureScope(planId)
      return { ok: true as const, source: 'current-plan' as const, results: await searchPlanPlaces(ctx.userId, planId, query, region) }
    }),
  })
  return {
    get_plan: getPlan,
    apply_plan_edits: apply,
    patch_plan_json: patch,
    get_panorama: panorama,
    search_poi: places,
  }
}

import { createTool } from '@mastra/core/tools'
import { createError } from 'h3'
import { z } from 'zod'
import { PlanSchema } from '../../shared/schemas/plan'
import { PlanMutationResultSchema } from '../../shared/schemas/preview'
import { getPanoramaImage } from '../services/baidu'
import { applyPlanEdits, getPlanSnapshot, patchPlan } from '../services/plan'
import { searchPlanPlaces } from '../services/poi'
import { selectPlanContext } from '../services/ai-context'
import { actionableMessage, isAbortError, markActionable } from '../utils/errors'
import { PLAN_TOOL_INPUT_SCHEMAS } from './tool-inputs'

export interface ToolContext {
  userId: string; planId: number; conversationId: number; assistantMessageId: number
  signal?: AbortSignal
  revision?: number
  onToolComplete?: () => void | Promise<void>
}
const scope = z.number().int().positive()
const mutationOutput = PlanMutationResultSchema

export function createPlanTools(ctx: ToolContext) {
  let revision = ctx.revision
  let mustRead = false
  async function expectedRevision() {
    if (mustRead) throw createError({ statusCode: 409, statusMessage: '规划已更新，请先用 get_plan 重读相关内容后再编辑' })
    if (revision === undefined) revision = (await getPlanSnapshot(ctx.userId, ctx.planId)).row.revision
    return revision
  }
  function ensureScope(planId: number) {
    ctx.signal?.throwIfAborted()
    if (planId !== ctx.planId) {
      throw createError({ statusCode: 400, statusMessage: '工具只能访问当前工作区，请使用当前 planId' })
    }
  }
  /** 只有我们自己产生的 4xx/5xx 文案才透传给用户；未知错误交回上层统一替换。 */
  async function guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      const result = await run()
      await ctx.onToolComplete?.()
      return result
    } catch (error) {
      if (isAbortError(error)) throw error
      if ((error as { statusCode?: number }).statusCode === 409) mustRead = true
      const message = actionableMessage(error)
      if (message) throw markActionable(message)
      throw error
    }
  }
  const getPlan = createTool({
    id: 'get_plan', description: '读取当前规划与修订号。小规划返回完整 JSON；长规划返回索引，可按 section=day、dayIndex 和 offset/limit 读取每日景点，或按 section=foodJournal/checklist 分页。冲突后必须重读相关内容。',
    inputSchema: PLAN_TOOL_INPUT_SCHEMAS.get_plan,
    outputSchema: z.object({ ok: z.literal(true), planId: scope, version: z.number().int(), revision: z.number().int(), plan: PlanSchema.optional() }).passthrough(),
    execute: ({ planId, section, dayIndex, offset, limit }) => guard(async () => {
      ensureScope(planId)
      const { plan, current, row } = await getPlanSnapshot(ctx.userId, planId)
      revision = row.revision
      mustRead = false
      return { ok: true as const, planId, version: current?.version ?? 0, revision, ...selectPlanContext(plan, section ?? 'all', dayIndex, offset, limit) }
    }),
  })
  const apply = createTool({
    id: 'apply_plan_edits',
    description: '原子编辑当前行程：按顺序应用操作数组。每项 { target: plan|day|spot|food|checklist, action: add|update|remove|move|status|toggle, day?, index?, to?, id?, text?, status?, value? }；value 为该对象的部分字段（数组整体替换、null 删除字段）。示例：[{"target":"spot","action":"add","day":0,"value":{"name":"断桥残雪","durationMinutes":90}},{"target":"checklist","action":"add","text":"预约门票"}]。工具直接作用于最新内容，不必先读取；返回版本冲突(409)时先用 get_plan 重读再重试。',
    inputSchema: PLAN_TOOL_INPUT_SCHEMAS.apply_plan_edits,
    outputSchema: mutationOutput,
    execute: (input) => guard(async () => {
      ensureScope(input.planId)
      const result = await applyPlanEdits(ctx.userId, ctx.planId, input.edits, {
        messageId: ctx.assistantMessageId, expectedVersion: input.expectedVersion, expectedRevision: await expectedRevision(),
      })
      revision = result.revision
      return {
        ok: true as const,
        version: result.version,
        revision: result.revision,
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
    inputSchema: PLAN_TOOL_INPUT_SCHEMAS.patch_plan_json,
    outputSchema: mutationOutput,
    execute: (input) => guard(async () => {
      ensureScope(input.planId)
      const result = await patchPlan(ctx.userId, ctx.planId, input.patch, {
        source: 'ai', messageId: ctx.assistantMessageId, expectedVersion: input.expectedVersion, expectedRevision: await expectedRevision(), note: input.reason,
      })
      revision = result.revision
      return {
        ok: true as const,
        version: result.version,
        revision: result.revision,
        versionId: result.versionId,
        changed: result.diff.length,
        skipped: result.skipped,
        preview: result.preview,
      }
    }),
  })
  const panorama = createTool({
    id: 'get_panorama', description: '获取已知 BD09 坐标的街景代理 URL。不得猜测坐标，失败保留空街景。',
    inputSchema: PLAN_TOOL_INPUT_SCHEMAS.get_panorama,
    outputSchema: z.object({ ok: z.boolean(), url: z.string(), message: z.string().optional() }),
    execute: ({ planId, lng, lat, heading, fov }) => guard(async () => {
      ensureScope(planId)
      await getPlanSnapshot(ctx.userId, planId)
      const query = new URLSearchParams({ location: `${lng},${lat}`, width: '640', height: '360' })
      if (heading !== undefined) query.set('heading', String(heading))
      if (fov !== undefined) query.set('fov', String(fov))
      try {
        await getPanoramaImage({ location: `${lng},${lat}`, width: 640, height: 360, heading, fov }, ctx.userId)
        return { ok: true, url: `/api/panorama?${query.toString()}` }
      } catch { return { ok: false, url: '', message: '该位置街景暂不可用，请保留空值并提示用户核实。' } }
    }),
  })
  const places = createTool({
    id: 'search_poi', description: '仅检索当前规划中已有的已定位地点，不是联网搜索。无结果时坐标保留null，请用户在路线舆图中补全。',
    inputSchema: PLAN_TOOL_INPUT_SCHEMAS.search_poi,
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

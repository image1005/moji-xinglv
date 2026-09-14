import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { PlanSchema } from '../../shared/schemas/plan'
import { getPanoramaImage, searchPoi } from '../services/baidu'
import { getLatestVersion, getPlanRow, parsePlanJson, patchPlan, savePlanVersion } from '../services/plan'

/**
 * Mastra 工具集（PRD §3.2）。所有工具都接收并校验 planId，
 * 与当前工作区不一致直接拒绝（硬约束 4：禁止跨规划读写）。
 */

export interface ToolContext {
  userId: string
  planId: number
  conversationId: number
  assistantMessageId: number
}

function ensureScope(ctx: ToolContext, planId: number) {
  if (planId !== ctx.planId) {
    throw new Error(`planId 越权：当前工作区为 ${ctx.planId}，收到 ${planId}。请使用当前 planId。`)
  }
}

export function createPlanTools(ctx: ToolContext) {
  const getPlan = createTool({
    id: 'get_plan',
    description: '读取当前工作区的行程 JSON、版本号与标题。任何修改前必须先调用。',
    inputSchema: z.object({ planId: z.number().int().describe('当前工作区 planId') }),
    execute: async (input) => {
      ensureScope(ctx, input.planId)
      const row = await getPlanRow(ctx.userId, ctx.planId)
      const latest = await getLatestVersion(ctx.planId)
      return {
        ok: true,
        planId: ctx.planId,
        version: latest?.version ?? 0,
        plan: parsePlanJson(row.planJson),
      }
    },
  })

  const createPlan = createTool({
    id: 'create_plan',
    description:
      '为当前空工作区写入初始行程（仅当工作区尚无景点/行程内容时可用）。已有内容时请改用 patch_plan_json。',
    inputSchema: z.object({
      planId: z.number().int(),
      plan: PlanSchema.describe('完整行程 JSON'),
    }),
    execute: async (input) => {
      ensureScope(ctx, input.planId)
      const row = await getPlanRow(ctx.userId, ctx.planId)
      const current = parsePlanJson(row.planJson)
      if (current.days.some((d) => d.spots.length > 0)) {
        return { ok: false, message: '当前工作区已有行程内容，请使用 patch_plan_json 增量修改。' }
      }
      const result = await savePlanVersion(ctx.userId, ctx.planId, {
        planJson: input.plan,
        source: 'ai',
        messageId: ctx.assistantMessageId,
        note: 'AI 创建初始行程',
      })
      return { ok: true, version: result.version, versionId: result.versionId, preview: result.preview }
    },
  })

  const patchPlanJson = createTool({
    id: 'patch_plan_json',
    description:
      '对当前行程应用 RFC 7396 Merge Patch：对象递归合并，数组整体替换，字段传 null 表示删除。只提交你确信的字段。',
    inputSchema: z.object({
      planId: z.number().int(),
      patch: z
        .record(z.string(), z.unknown())
        .describe('Merge Patch 对象，例如 {"summary":"...","days":[...]}'),
      reason: z.string().optional().describe('本次修改的简短说明'),
    }),
    execute: async (input) => {
      ensureScope(ctx, input.planId)
      const result = await patchPlan(ctx.userId, ctx.planId, input.patch, {
        source: 'ai',
        messageId: ctx.assistantMessageId,
      })
      return {
        ok: true,
        version: result.version,
        versionId: result.versionId,
        changed: result.diff.length,
        reason: input.reason ?? '',
        preview: result.preview,
      }
    },
  })

  const updatePlanJson = createTool({
    id: 'update_plan_json',
    description: '用完整行程 JSON 整体覆盖当前工作区（仅在需要整体重写时使用，常规修改优先 patch_plan_json）。',
    inputSchema: z.object({
      planId: z.number().int(),
      plan: PlanSchema.describe('完整行程 JSON'),
      reason: z.string().optional(),
    }),
    execute: async (input) => {
      ensureScope(ctx, input.planId)
      const result = await savePlanVersion(ctx.userId, ctx.planId, {
        planJson: input.plan,
        source: 'ai',
        messageId: ctx.assistantMessageId,
        note: input.reason,
      })
      return { ok: true, version: result.version, versionId: result.versionId, skipped: result.skipped, preview: result.preview }
    },
  })

  const savePlan = createTool({
    id: 'save_plan',
    description: '将当前行程另存为新版本（source=user），用于确认落地。内容无变化时不会创建新版本。',
    inputSchema: z.object({ planId: z.number().int(), note: z.string().optional() }),
    execute: async (input) => {
      ensureScope(ctx, input.planId)
      const result = await savePlanVersion(ctx.userId, ctx.planId, {
        source: 'user',
        messageId: ctx.assistantMessageId,
        note: input.note,
      })
      return { ok: true, version: result.version, versionId: result.versionId, skipped: result.skipped, preview: result.preview }
    },
  })

  const getPanorama = createTool({
    id: 'get_panorama',
    description:
      '获取指定坐标的百度街景图片 URL（服务端代理 + 缓存，可直接写入 spot.panorama）。坐标使用百度 BD09。',
    inputSchema: z.object({
      planId: z.number().int(),
      lng: z.number().describe('经度'),
      lat: z.number().describe('纬度'),
      heading: z.number().min(0).max(360).optional().describe('水平视角，默认 0'),
      fov: z.number().min(10).max(360).optional().describe('视野范围，默认 90'),
    }),
    execute: async (input) => {
      ensureScope(ctx, input.planId)
      const location = `${input.lng},${input.lat}`
      const url = `/api/panorama?location=${encodeURIComponent(location)}&width=640&height=360${
        input.heading !== undefined ? `&heading=${input.heading}` : ''
      }${input.fov !== undefined ? `&fov=${input.fov}` : ''}`
      try {
        await getPanoramaImage({
          location,
          width: 640,
          height: 360,
          heading: input.heading,
          fov: input.fov,
        })
        return { ok: true, url }
      } catch (error) {
        return {
          ok: false,
          url,
          message: `街景暂不可用（${error instanceof Error ? error.message : '未知错误'}），可在 notes 里说明。`,
        }
      }
    },
  })

  const searchPoiTool = createTool({
    id: 'search_poi',
    description: '按关键词在城市范围内检索 POI（返回名称、地址与百度坐标），用于补全景点坐标。',
    inputSchema: z.object({
      planId: z.number().int(),
      query: z.string().min(1).describe('关键词，如「西湖雷峰塔」'),
      region: z.string().min(1).describe('城市名，如「杭州」'),
    }),
    execute: async (input) => {
      ensureScope(ctx, input.planId)
      try {
        const results = await searchPoi(input.query, input.region)
        return { ok: true, results }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'POI 检索失败' }
      }
    },
  })

  return {
    get_plan: getPlan,
    create_plan: createPlan,
    patch_plan_json: patchPlanJson,
    update_plan_json: updatePlanJson,
    save_plan: savePlan,
    get_panorama: getPanorama,
    search_poi: searchPoiTool,
  }
}

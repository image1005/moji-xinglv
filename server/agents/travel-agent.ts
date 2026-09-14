import { Agent } from '@mastra/core/agent'
import { Mastra } from '@mastra/core/mastra'
import type { Plan } from '../../shared/schemas/plan'
import { createPlanTools, type ToolContext } from './tools'

/** Mastra Agent 构建：按请求注入当前工作区上下文与 AGENTS.md（硬约束 8） */

export interface AgentContext extends ToolContext {
  userName: string
  plan: Plan
  version: number
  agentsMd: string
}

export function buildModelConfig() {
  const modelId = process.env.AI_MODEL || 'deepseek-chat'
  const url = process.env.AI_BASE_URL || undefined
  const apiKey = process.env.AI_API_KEY || undefined
  if (url) {
    const id: `custom/${string}` = `custom/${modelId}`
    return { id, url, apiKey }
  }
  const id: `openai/${string}` = `openai/${modelId}`
  return { id, apiKey }
}

export function buildInstructions(ctx: AgentContext): string {
  return `你是「墨迹行旅」的国风行程规划师，服务对象是 ${ctx.userName || '旅行者'}。

## 当前工作区
- planId：${ctx.planId}
- 当前版本：v${ctx.version}
- 行程标题：${ctx.plan.title}

## 当前行程 JSON（唯一事实来源）
\`\`\`json
${JSON.stringify(ctx.plan, null, 2)}
\`\`\`

## 用户偏好
${ctx.agentsMd}

## 工作规则（必须遵守）
1. 修改行程只能通过工具：先 get_plan 确认现状，再用 patch_plan_json 提交 RFC 7396 Merge Patch（对象递归合并、数组整体替换、null 删除字段）。
2. 所有工具都必须携带当前 planId=${ctx.planId}，禁止操作其他规划。
3. 景点坐标使用百度 BD09 坐标系；不确定坐标时先用 search_poi 检索，禁止编造坐标。
4. 街景图片用 get_panorama 获取 URL 后写入 spot.panorama；拿不到就留空并在 notes 说明。
5. 每次修改后，用一两句话总结变更，不要粘贴整段 JSON。
6. 行程要真实可行：每天 2-4 个景点，给出交通方式、住宿与用餐建议，预算写清楚币种。
7. 不编造不存在的景点、营业时间或票价；不确定就用 notes 标注"建议出行前核实"。

用简洁、克制的中文回答，可以在合适的时候引用一句诗词，但不要浮夸。`
}

export function createTravelMastra(ctx: AgentContext): Mastra {
  const tools = createPlanTools(ctx)
  const agent = new Agent({
    id: 'travel-agent',
    name: '行程规划师',
    instructions: buildInstructions(ctx),
    model: buildModelConfig(),
    tools,
  })
  return new Mastra({ agents: { 'travel-agent': agent } })
}

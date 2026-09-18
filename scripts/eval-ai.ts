/** 默认离线执行固定契约样例；--live 仅在 EVAL_LIVE=true 时调用用户配置的模型。 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { evaluationCases, evaluationPlan, matchesEvaluation } from '../evals/plan-cases'
import { PlanSchema } from '../shared/schemas/plan'
import { applyPlanEditOps } from '../shared/utils/plan-edits'

if (!process.argv.includes('--live')) {
  let passed = 0
  for (const entry of evaluationCases) {
    let result: boolean
    try { result = matchesEvaluation(PlanSchema.parse(applyPlanEditOps(evaluationPlan(), entry.edits)), entry) && !entry.reject }
    catch { result = entry.reject === true }
    assert(result, `离线评测失败：${entry.name}`)
    passed++
  }
  console.log(JSON.stringify({ mode: 'offline-contract', passed, total: evaluationCases.length, note: '验证结构化编辑契约，不代表真实模型成功率；取消、冲突、恢复另由集成测试覆盖。' }))
} else {
  assert(process.env.EVAL_LIVE === 'true', '真实评测会调用外部模型，请显式设置 EVAL_LIVE=true；默认不产生调用')
  assert(process.env.AI_API_KEY, '缺少 AI_API_KEY')
  const count = Number(process.env.EVAL_MAX_CASES ?? 5)
  assert(Number.isInteger(count) && count >= 1 && count <= 27, 'EVAL_MAX_CASES 必须为1–27，默认5')
  const root = await realpath(tmpdir())
  const directory = await mkdtemp(join(root, 'shanhai-eval-'))
  assert(resolve(directory).startsWith(root + sep))
  process.env.DATABASE_URL = `file:${join(directory, 'eval.db').replaceAll('\\', '/')}`
  process.env.BAIDU_MAP_AK = ''
  let close: (() => void) | undefined
  try {
    await import('../server/database/migrate')
    const { db } = await import('../server/utils/db')
    const schema = await import('../server/database/schema')
    close = () => db.$client.close()
    const userId = crypto.randomUUID()
    db.insert(schema.user).values({ id: userId, email: `${userId}@example.invalid`, name: '隔离评测用户', createdAt: new Date(), updatedAt: new Date() }).run()
    const { createPlan, getPlanSnapshot } = await import('../server/services/plan')
    const { createTravelMastra } = await import('../server/agents/travel-agent')
    const { appendMessage, createConversation } = await import('../server/services/conversation')
    const results: { name: string; passed: boolean; milliseconds: number; inputTokens?: number; outputTokens?: number }[] = []
    for (const entry of evaluationCases.filter((item) => !item.reject).slice(0, count)) {
      const plan = evaluationPlan()
      const created = await createPlan(userId, plan)
      const conversation = await createConversation(userId, created.planId)
      const message = await appendMessage(conversation.id, { role: 'assistant' })
      const signal = AbortSignal.timeout(90_000)
      const mastra = createTravelMastra({ userId, planId: created.planId, conversationId: conversation.id, assistantMessageId: message.id, userName: '评测用户', plan, version: 1, revision: 1, agentsMd: '仅完成指定编辑，不额外修改其他信息。', signal })
      const started = performance.now()
      try {
        const stream = await mastra.getAgent('travel-agent').stream(entry.prompt, { maxSteps: 6, toolCallConcurrency: 1, abortSignal: signal, modelSettings: { maxOutputTokens: 1500, maxRetries: 0 } })
        await stream.text
        const usage = await stream.usage
        const current = await getPlanSnapshot(userId, created.planId)
        results.push({ name: entry.name, passed: matchesEvaluation(current.plan, entry), milliseconds: Math.round(performance.now() - started), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
      } catch { results.push({ name: entry.name, passed: false, milliseconds: Math.round(performance.now() - started) }) }
    }
    const report = { mode: 'live', model: process.env.AI_MODEL, passed: results.filter((item) => item.passed).length, total: results.length, results }
    await mkdir('.verification', { recursive: true })
    await Bun.write('.verification/eval-live.json', JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    if (report.passed !== report.total) process.exitCode = 1
  } finally {
    close?.()
    const checked = await realpath(directory)
    const segment = relative(root, checked)
    assert(segment && segment !== '..' && !segment.startsWith(`..${sep}`) && resolve(root, segment) === checked, '停止清理：评测临时目录边界异常')
    await rm(checked, { recursive: true, force: true })
  }
}

import { expect, it } from 'vitest'
import { evaluationCases, evaluationPlan, matchesEvaluation } from '../evals/plan-cases'
import { PlanSchema } from '../shared/schemas/plan'
import { applyPlanEditOps } from '../shared/utils/plan-edits'

it.each(evaluationCases)('固定行程评测：$name', (entry) => {
  const original = evaluationPlan()
  const before = JSON.stringify(original)
  const apply = () => PlanSchema.parse(applyPlanEditOps(original, entry.edits))
  if (entry.reject) expect(apply).toThrow()
  else expect(matchesEvaluation(apply(), entry)).toBe(true)
  expect(JSON.stringify(original)).toBe(before)
})

it('命中目标字段但改坏其他内容，不能被评测判为成功', () => {
  const entry = evaluationCases.find(item => item.name === 'title')!
  const plan = PlanSchema.parse(applyPlanEditOps(evaluationPlan(), entry.edits))
  plan.budget.total = 999999
  expect(matchesEvaluation(plan, entry)).toBe(false)
})

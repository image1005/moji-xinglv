import type { Plan } from '../../shared/schemas/plan'

export const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

/** A compact authoritative overview preserves indexes; details remain available via scoped reads. */
export function planContext(plan: Plan, maxBytes = 16000): string {
  if (jsonBytes(plan) <= maxBytes) return JSON.stringify(plan)
  const overview = {
    title: plan.title, budget: plan.budget, tags: plan.tags,
    days: plan.days.map((day, index) => ({ index, date: day.date, city: day.city, spots: day.spots.length })),
    foodJournalCount: plan.foodJournal.length, checklistCount: plan.checklist.length,
    note: '长规划仅显示索引。修改现有条目之前用 get_plan 按 section/dayIndex/offset/limit 读取相关内容；不要用概要替换完整数组。',
  }
  if (jsonBytes(overview) <= maxBytes) return JSON.stringify(overview)
  return JSON.stringify({ title: plan.title, budget: { total: plan.budget.total, currency: plan.budget.currency }, dayCount: plan.days.length, foodJournalCount: plan.foodJournal.length, checklistCount: plan.checklist.length, note: overview.note })
}

export type PlanReadSection = 'all' | 'overview' | 'metadata' | 'budget' | 'tips' | 'day' | 'foodJournal' | 'checklist'

export function selectPlanContext(plan: Plan, section: PlanReadSection, dayIndex = 0, offset = 0, limit = 10) {
  if (section === 'all') return jsonBytes(plan) <= 16000 ? { plan } : { overview: JSON.parse(planContext(plan)), partial: true }
  if (section === 'overview') return { overview: JSON.parse(planContext(plan, 1)), partial: true }
  if (section === 'metadata') return { metadata: { title: plan.title, summary: plan.summary, cover: plan.cover, tags: plan.tags }, partial: true }
  if (section === 'budget') {
    const items = Object.entries(plan.budget.breakdown ?? {})
    return { budget: { total: plan.budget.total, currency: plan.budget.currency }, breakdown: items.slice(offset, offset + limit), offset, total: items.length, hasMore: offset + limit < items.length, partial: true }
  }
  if (section === 'day') {
    const day = plan.days[dayIndex]
    if (!day) return { day: null, total: plan.days.length, partial: true }
    let selected = day.spots.slice(offset, offset + limit)
    while (selected.length > 1 && jsonBytes(selected) > 16000) selected = selected.slice(0, -1)
    return { day: { ...day, spots: selected }, dayIndex, offset, nextOffset: offset + selected.length, total: day.spots.length, hasMore: offset + selected.length < day.spots.length, partial: true }
  }
  let selected = plan[section].slice(offset, offset + limit)
  while (selected.length > 1 && jsonBytes(selected) > 16000) selected = selected.slice(0, -1)
  return { section, items: selected, offset, nextOffset: offset + selected.length, total: plan[section].length, hasMore: offset + selected.length < plan[section].length, partial: true }
}

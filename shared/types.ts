import type { Plan } from './schemas/plan'
import type { PlanPreview } from './schemas/preview'
import type { MessageRecord } from './schemas/workspace'
export type { PlanPreview } from './schemas/preview'
export type { Page, PageOptions, MessageRecord } from './schemas/workspace'
export type PlanSource = PlanPreview['source']
export type MessageRole = MessageRecord['role']

/** Stored snapshots and chat previews have separate contracts and an explicit projection. */
export function toPlanPreview(plan: Plan, planId: number, version: number, source: PlanSource, message?: string): PlanPreview {
  return { planId, version, title: plan.title, summary: plan.summary, cover: plan.cover,
    days: plan.days.map(d => ({ date: d.date, city: d.city, spots: d.spots.map(s => ({ id: s.id, name: s.name, time: s.time, panorama: s.panorama })) })),
    foodJournal: plan.foodJournal.map(item => ({ id: item.id, name: item.name, city: item.city })), source, message }
}

import type { z } from 'zod'
import { ChecklistItemSchema, DaySchema, FoodEntrySchema, formatPlanIssues, SpotSchema, type Plan } from '../schemas/plan'
import { applyMergePatch } from './merge-patch'

/**
 * 原子编辑操作：由 apply_plan_edits 工具与服务层共用。
 * target 决定对象，action 决定动作，value 为该对象的部分字段（合并语义同 RFC7396）。
 */
export type PlanEditTarget = 'plan' | 'day' | 'spot' | 'food' | 'checklist'
export type PlanEditAction = 'add' | 'update' | 'remove' | 'move' | 'status' | 'toggle'

export interface PlanEditOp {
  target: PlanEditTarget
  action: PlanEditAction
  day?: number
  index?: number
  to?: number
  id?: string
  text?: string
  status?: 'wishlist' | 'tasted'
  value?: Record<string, unknown>
}

export class PlanEditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanEditError'
  }
}

const ALLOWED: Record<PlanEditTarget, readonly PlanEditAction[]> = {
  plan: ['update'],
  day: ['add', 'update', 'remove', 'move'],
  spot: ['add', 'update', 'remove', 'move'],
  food: ['add', 'update', 'remove', 'status'],
  checklist: ['add', 'toggle', 'remove'],
}

function parseValue<T>(schema: z.ZodType<T>, input: unknown, label: string, name: string): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new PlanEditError(`${label}：${name}字段不合法（${formatPlanIssues(result.error.issues)}）`)
  }
  return result.data
}

function itemPosition(value: number | undefined, size: number, label: string, name: string): number {
  if (!Number.isInteger(value) || value === undefined || value < 0 || value >= size) {
    throw new PlanEditError(`${label}：${name}下标 ${value ?? '（缺失）'} 超出范围（0–${Math.max(0, size - 1)}）`)
  }
  return value
}

function insertPosition(value: number | undefined, size: number, label: string, name: string): number {
  if (!Number.isInteger(value) || value === undefined || value < 0 || value > size) {
    throw new PlanEditError(`${label}：${name} ${value ?? '（缺失）'} 超出范围（0–${size}）`)
  }
  return value
}

export function applyPlanEditOps(plan: Plan, ops: readonly PlanEditOp[]): Plan {
  let next: Plan = structuredClone(plan)
  ops.forEach((op, opIndex) => {
    const label = `第 ${opIndex + 1} 项编辑`
    const allowed = ALLOWED[op.target]
    if (!allowed || !allowed.includes(op.action)) {
      throw new PlanEditError(`${label}：不支持 ${op.target ?? '（缺失）'}/${op.action ?? '（缺失）'} 组合${allowed ? `，${op.target} 仅支持 ${allowed.join('、')}` : ''}`)
    }
    switch (op.target) {
      case 'plan': {
        next = applyMergePatch(next, op.value ?? {}) as Plan
        return
      }
      case 'day': {
        if (op.action === 'add') {
          next.days.push(parseValue(DaySchema, op.value ?? {}, label, '日程'))
          return
        }
        if (op.action === 'move') {
          const from = itemPosition(op.index, next.days.length, label, '日程')
          const to = insertPosition(op.to, next.days.length - 1, label, '目标位置')
          const [item] = next.days.splice(from, 1)
          next.days.splice(to, 0, item!)
          return
        }
        const index = itemPosition(op.index, next.days.length, label, '日程')
        if (op.action === 'remove') {
          next.days.splice(index, 1)
          return
        }
        next.days[index] = parseValue(DaySchema, applyMergePatch(next.days[index], op.value ?? {}), label, '日程')
        return
      }
      case 'spot': {
        const dayIndex = itemPosition(op.day, next.days.length, label, '日期')
        const spots = next.days[dayIndex]!.spots
        if (op.action === 'add') {
          spots.push(parseValue(SpotSchema, op.value ?? {}, label, '景点'))
          return
        }
        if (op.action === 'move') {
          const from = itemPosition(op.index, spots.length, label, '景点')
          const to = insertPosition(op.to, spots.length - 1, label, '目标位置')
          const [item] = spots.splice(from, 1)
          spots.splice(to, 0, item!)
          return
        }
        const index = itemPosition(op.index, spots.length, label, '景点')
        if (op.action === 'remove') {
          spots.splice(index, 1)
          return
        }
        spots[index] = parseValue(SpotSchema, applyMergePatch(spots[index], op.value ?? {}), label, '景点')
        return
      }
      case 'food': {
        if (op.action === 'add') {
          next.foodJournal.push(parseValue(FoodEntrySchema, { id: crypto.randomUUID(), ...op.value }, label, '食记'))
          return
        }
        const index = next.foodJournal.findIndex((item) => item.id === op.id)
        if (index < 0) throw new PlanEditError(`${label}：未找到 id 为 ${op.id ?? '（缺失）'} 的食记条目`)
        if (op.action === 'remove') {
          next.foodJournal.splice(index, 1)
          return
        }
        if (op.action === 'status') {
          if (!op.status) throw new PlanEditError(`${label}：切换状态需要 status（wishlist 或 tasted）`)
          next.foodJournal[index]!.status = op.status
          return
        }
        next.foodJournal[index] = parseValue(FoodEntrySchema, applyMergePatch(next.foodJournal[index], op.value ?? {}), label, '食记')
        return
      }
      default: {
        if (op.action === 'add') {
          const text = (op.text ?? '').trim()
          if (!text) throw new PlanEditError(`${label}：新增清单条目需要 text`)
          next.checklist.push(parseValue(ChecklistItemSchema, { id: crypto.randomUUID(), text, done: op.value?.done === true }, label, '清单'))
          return
        }
        const index = next.checklist.findIndex((item) => item.id === op.id)
        if (index < 0) throw new PlanEditError(`${label}：未找到 id 为 ${op.id ?? '（缺失）'} 的清单条目`)
        if (op.action === 'remove') {
          next.checklist.splice(index, 1)
          return
        }
        const item = next.checklist[index]!
        item.done = op.value?.done === undefined ? !item.done : op.value.done === true
      }
    }
  })
  return next
}

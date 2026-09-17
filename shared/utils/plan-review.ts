import type { Plan } from '../schemas/plan'

export interface PlanReviewIssue {
  code: string
  severity: 'warning' | 'info'
  message: string
  dayIndex?: number
}

function calendarDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null
}

function minuteOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1]); const minute = Number(match[2])
  return hour < 24 && minute < 60 ? hour * 60 + minute : null
}

/** 可重复、无需外部数据的行程检查。费用仅比较 budget 明细，食记不重复计入。 */
export function reviewPlan(plan: Plan): PlanReviewIssue[] {
  const issues: PlanReviewIssue[] = []
  let previousDate: number | null = null
  plan.days.forEach((day, dayIndex) => {
    const add = (code: string, message: string, severity: PlanReviewIssue['severity'] = 'warning') => {
      issues.push({ code, severity, message: `第 ${dayIndex + 1} 天：${message}`, dayIndex })
    }
    const date = calendarDate(day.date)
    if (day.date && date === null) add('invalid-date', '日期需要是有效的 YYYY-MM-DD，例如 2026-10-01。')
    if (date !== null) {
      if (previousDate !== null && date <= previousDate) add('date-order', '日期与前一天重复或早于前一天，请检查顺序。')
      previousDate = date
    }
    const seen = new Set<string>()
    let previousEnd: number | null = null
    for (const spot of day.spots) {
      const name = spot.name.normalize('NFKC').trim().toLocaleLowerCase()
      if (spot.category !== 'transport' && spot.category !== 'stay') {
        if (seen.has(name)) add('duplicate-spot', `「${spot.name}」出现多次，请确认是否需要重复游览。`)
        seen.add(name)
      }
      const start = minuteOfDay(spot.time)
      if (start !== null) {
        if (previousEnd !== null && start < previousEnd) add('time-overlap', `「${spot.name}」的开始时间与之前安排重叠；尚未计入交通时间。`)
        const end = start + spot.durationMinutes
        if (end > 1440) add('cross-midnight', `「${spot.name}」的停留跨越午夜，请确认日期安排。`)
        previousEnd = Math.max(previousEnd ?? 0, end)
      }
    }
    const duration = day.spots.reduce((total, spot) => total + spot.durationMinutes, 0)
    if (duration > 600) add('dense-day', `已安排 ${(duration / 60).toFixed(1)} 小时停留，尚未计入交通和休息，建议适当留白。`)
    const missing = day.spots.filter((spot) => spot.lng === null || spot.lat === null).length
    if (missing) add('missing-coordinates', `${missing} 处地点尚未定位，可以在路线舆图中补全可靠坐标。`, 'info')
    if (day.spots.length > 6 && duration <= 600) add('many-stops', '地点较多，建议确认预约与通行安排，并留出休息时间。', 'info')
  })
  const breakdown = Object.values(plan.budget.breakdown ?? {})
  const sum = breakdown.reduce((total, value) => total + value, 0)
  if (breakdown.length && Math.abs(sum - plan.budget.total) > 0.01) {
    issues.push({ code: 'budget-mismatch', severity: 'warning', message: `预算分类合计 ${sum.toFixed(2)} ${plan.budget.currency}，与总额 ${plan.budget.total.toFixed(2)} 不一致。食记与景点费用未重复计入。` })
  }
  return issues
}

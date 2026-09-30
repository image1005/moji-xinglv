import type { Plan } from '#shared/schemas/plan'
import type { PlanPreview } from '#shared/types'

export function isDraftPreview(preview: PlanPreview) {
  return preview.draftId !== undefined && preview.status !== 'recovered'
}

/** A draft's version number identifies its baseline, not the draft snapshot. */
export async function loadPreviewSnapshot(preview: PlanPreview, loader: {
  draftPlan: (planId: number, draftId: number) => Promise<{ draft: { plan: Plan } }>
  versionPlan: (planId: number, version: number) => Promise<{ plan: Plan | null }>
}) {
  if (isDraftPreview(preview)) return (await loader.draftPlan(preview.planId, preview.draftId!)).draft.plan
  const { plan } = await loader.versionPlan(preview.planId, preview.version)
  if (!plan) throw new Error('此版本暂无可复制的行程快照。')
  return plan
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlanSchema } from '../shared/schemas/plan'
import { toPlanPreview, type MessageRecord, type PlanPreview } from '../shared/types'
import { messagePreview, toWorkbenchMessages } from '../app/features/workspace/messages'
import { isDraftPreview, loadPreviewSnapshot } from '../app/utils/preview-snapshot'
import { api } from '../app/utils/api'

const baseline = PlanSchema.parse({ title: '正式基线', summary: '已保存行程' })
const partial = PlanSchema.parse({ title: '部分成果', summary: '工具新写入的草稿' })
const preview = (status: PlanPreview['status'] = 'draft'): PlanPreview => ({ ...toPlanPreview(partial, 1, 3, 'ai'), draftId: 42, status })
const tool = (data: PlanPreview, state = 'output-available') => ({ type: 'tool-apply_plan_edits', state, output: { preview: data } })
afterEach(() => vi.unstubAllGlobals())

describe('草稿与正式快照分离', () => {
  it.each(['draft', 'recoverable'] as const)('%s 复制读取草稿真实内容，不读取同号正式基线', async status => {
    const loader = { draftPlan: vi.fn().mockResolvedValue({ draft: { plan: partial } }), versionPlan: vi.fn().mockResolvedValue({ plan: baseline }) }
    expect(await loadPreviewSnapshot(preview(status), loader)).toEqual(partial)
    expect(loader.draftPlan).toHaveBeenCalledWith(1, 42)
    expect(loader.versionPlan).not.toHaveBeenCalled()
  })
  it('已恢复预览使用恢复出的正式版本，保留的 draftId 不改变读取目标', async () => {
    const loader = { draftPlan: vi.fn(), versionPlan: vi.fn().mockResolvedValue({ plan: partial }) }
    const recovered = { ...preview('recovered'), version: 6 }
    expect(isDraftPreview(recovered)).toBe(false)
    expect(await loadPreviewSnapshot(recovered, loader)).toEqual(partial)
    expect(loader.versionPlan).toHaveBeenCalledWith(1, 6)
    expect(loader.draftPlan).not.toHaveBeenCalled()
  })
  it('草稿读取失败不能退回基线快照伪装为部分成果', async () => {
    const loader = { draftPlan: vi.fn().mockRejectedValue(new Error('草稿已失效')), versionPlan: vi.fn() }
    await expect(loadPreviewSnapshot(preview(), loader)).rejects.toThrow('草稿已失效')
    expect(loader.versionPlan).not.toHaveBeenCalled()
  })
})

describe('每轮只展示权威成果', () => {
  it.each(['recoverable', 'recovered'] as const)('%s 权威状态覆盖同基线版本的旧工具预览', status => {
    const authoritative = preview(status)
    const records = [{ id: 9, role: 'assistant', content: '', preview: authoritative,
      toolCalls: [{ name: 'apply_plan_edits', output: { preview: preview() } }] }] as MessageRecord[]
    expect(messagePreview(toWorkbenchMessages(records)[0]!.parts)).toEqual(authoritative)
  })
  it('成功完成只选最终正式版本，保留工具记录但不再展示中途草稿', () => {
    const final = toPlanPreview(partial, 1, 4, 'ai')
    const parts = [tool(preview()), tool({ ...preview(), summary: '第二步' }), { type: 'data-preview', data: final }]
    expect(messagePreview(parts)).toEqual(final)
    expect(messagePreview(parts)?.draftId).toBeUndefined()
    expect(parts).toHaveLength(3)
  })
  it('流中尚无终态时仅选最新成功检查点，失败工具不会吞掉部分成果', () => {
    const latest = { ...preview(), summary: '最后成功写入' }
    expect(messagePreview([tool(preview()), tool(latest), tool(preview(), 'output-error')])).toEqual(latest)
  })
  it('最终内容回到基线时，正式无变化预览仍覆盖旧草稿', () => {
    const final = toPlanPreview(baseline, 1, 3, 'ai', '内容无变化')
    expect(messagePreview([tool(preview()), { type: 'data-preview', data: final }])).toEqual(final)
  })
})

it('草稿 API 解析完整服务端结果并透传明确恢复的乐观锁', async () => {
  const draft = { id: 42, runId: 7, messageId: 9, planId: 1, baseVersionId: 300, baseRevision: 12, revision: 14,
    status: 'recoverable', resultVersionId: null, createdAt: '2026-09-30', updatedAt: '2026-09-30', plan: partial }
  const saved = { planId: 1, version: 4, revision: 15, versionId: 301, skipped: false, preview: toPlanPreview(partial, 1, 4, 'user') }
  const fetcher = vi.fn().mockResolvedValueOnce({ draft }).mockResolvedValueOnce(saved)
  vi.stubGlobal('$fetch', fetcher)
  expect((await api.plans.draftPlan(1, 42)).draft).toEqual(draft)
  expect(await api.plans.restoreDraft(1, 42, { expectedVersion: 3, expectedRevision: 14, conversationId: 10 })).toEqual(saved)
  expect(fetcher).toHaveBeenLastCalledWith('/api/plans/1/drafts/42/restore', { method: 'POST', body: { expectedVersion: 3, expectedRevision: 14, conversationId: 10 } })
})

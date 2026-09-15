import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef } from 'vue'
import type { MessageRecord, PlanPreview } from '../shared/types'
import type { PlanDetail } from '../app/utils/api'
import { toWorkbenchMessages, useWorkspace } from '../app/composables/useWorkspace'

const mocks = vi.hoisted(() => ({
  plans: { list: vi.fn(), detail: vi.fn(), versions: vi.fn(), create: vi.fn(), save: vi.fn(), switchVersion: vi.fn(), remove: vi.fn(), updateMeta: vi.fn() },
  conversations: { list: vi.fn(), detail: vi.fn(), create: vi.fn(), remove: vi.fn() },
}))

vi.mock('~/utils/api', () => ({
  api: mocks,
  apiErrorMessage: (error: Error) => error.message,
}))
vi.mock('@ai-sdk/vue', () => ({
  Chat: class {
    messages: unknown[] = []
    status = 'ready'
    stop = vi.fn().mockResolvedValue(undefined)
    sendMessage = vi.fn().mockResolvedValue(undefined)
    constructor(public options: { onFinish: (event: { isAbort: boolean }) => void }) {}
  },
}))
vi.mock('ai', () => ({ DefaultChatTransport: class { api = '/api/chat' } }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function plan(id: number): PlanDetail {
  return { id, title: `规划 ${id}`, version: 1, plan: { title: `规划 ${id}`, days: [] } } as PlanDetail
}

let app: object
beforeEach(() => {
  vi.clearAllMocks()
  app = {}
  vi.stubGlobal('useNuxtApp', () => app)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('computed', computed)
  mocks.plans.list.mockResolvedValue([])
  mocks.plans.detail.mockImplementation(async (id: number) => plan(id))
  mocks.plans.versions.mockResolvedValue([])
  mocks.conversations.list.mockResolvedValue([
    { id: 11, planId: 1, title: '会话一' },
    { id: 22, planId: 2, title: '会话二' },
  ])
  mocks.conversations.detail.mockImplementation(async (id: number) => ({ conversation: { id, planId: id === 11 ? 1 : 2 }, messages: [] }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('工作区状态隔离与并发保护', () => {
  it('同一 Nuxt app 共用状态，不同 SSR app 不共享任何工作区', () => {
    const first = useWorkspace()
    first.currentPlan.value = plan(1)
    expect(useWorkspace()).toBe(first)
    app = {}
    const second = useWorkspace()
    expect(second).not.toBe(first)
    expect(second.currentPlan.value).toBeNull()
    expect(second.chat.value).toBeNull()
  })

  it('后完成的旧规划响应不能覆盖新规划', async () => {
    const old = deferred<PlanDetail>()
    mocks.plans.detail.mockImplementation((id: number) => id === 1 ? old.promise : Promise.resolve(plan(id)))
    const workspace = useWorkspace()
    const first = workspace.openPlanView(1)
    await workspace.openPlanView(2)
    old.resolve(plan(1))
    await first
    expect(workspace.currentPlan.value?.id).toBe(2)
    expect(workspace.mainMode.value).toBe('plan')
    expect(workspace.loading.value).toBe(false)
  })

  it('退出后未完成的列表与详情请求不能重新填入状态', async () => {
    const list = deferred<PlanDetail[]>()
    const detail = deferred<PlanDetail>()
    mocks.plans.list.mockReturnValue(list.promise)
    mocks.plans.detail.mockReturnValue(detail.promise)
    const workspace = useWorkspace()
    const requests = [workspace.loadPlans(), workspace.openPlanView(1)]
    workspace.resetWorkspace()
    list.resolve([plan(1)])
    detail.resolve(plan(1))
    await Promise.all(requests)
    expect(workspace.plans.value).toEqual([])
    expect(workspace.currentPlan.value).toBeNull()
    expect(workspace.loading.value).toBe(false)
  })

  it('切到不同规划停止旧聊天，旧会话响应不能覆盖新聊天', async () => {
    const workspace = useWorkspace()
    await workspace.openWorkspace(1)
    const oldChat = workspace.chat.value!
    await workspace.openPlanView(2)
    expect(oldChat.stop).toHaveBeenCalled()
    expect(workspace.chat.value).toBeNull()
    expect(workspace.currentConversationId.value).toBeNull()
    expect(workspace.currentPlan.value?.id).toBe(2)
  })

  it('切换会话后丢弃旧消息加载响应', async () => {
    const workspace = useWorkspace()
    await workspace.loadConversations()
    const slow = deferred<{ conversation: { id: number; planId: number }; messages: MessageRecord[] }>()
    mocks.conversations.detail.mockImplementation((id: number) => id === 11 ? slow.promise : Promise.resolve({ conversation: { id, planId: 2 }, messages: [] }))
    const first = workspace.openConversation(11)
    await Promise.resolve()
    await workspace.openConversation(22)
    slow.resolve({ conversation: { id: 11, planId: 1 }, messages: [] })
    await first
    expect(workspace.currentConversationId.value).toBe(22)
    expect(workspace.currentPlan.value?.id).toBe(2)
  })

  it('保存保留规划模式，传草稿版本且不携带其他规划会话', async () => {
    const workspace = useWorkspace()
    await workspace.openWorkspace(1)
    await workspace.openPlanView(2)
    workspace.currentConversationId.value = 11
    mocks.plans.save.mockResolvedValue({ planId: 2, version: 2, skipped: false })
    await workspace.savePlan(undefined, 7)
    expect(mocks.plans.save).toHaveBeenCalledWith(2, { planJson: undefined, expectedVersion: 7, conversationId: undefined })
    expect(workspace.mainMode.value).toBe('plan')
  })

  it('元数据更新按第二参数、patch 版本、当前版本的优先级发送前提', async () => {
    const workspace = useWorkspace()
    await workspace.openPlanView(1)
    await workspace.updatePlanMeta({ title: '新标题' })
    expect(mocks.plans.updateMeta).toHaveBeenLastCalledWith(1, { title: '新标题', expectedVersion: 1 })
    await workspace.updatePlanMeta({ title: '新标题', expectedVersion: 5 })
    expect(mocks.plans.updateMeta).toHaveBeenLastCalledWith(1, { title: '新标题', expectedVersion: 5 })
    await workspace.updatePlanMeta({ title: '新标题', expectedVersion: 5 }, 7)
    expect(mocks.plans.updateMeta).toHaveBeenLastCalledWith(1, { title: '新标题', expectedVersion: 7 })
  })

  it('可见地捕获保存冲突，不向事件处理器抛出拒绝', async () => {
    const workspace = useWorkspace()
    await workspace.openPlanView(1)
    mocks.plans.save.mockRejectedValue(new Error('版本冲突'))
    expect(await workspace.savePlan()).toBeNull()
    expect(workspace.errorMessage.value).toContain('版本冲突')
  })

  it('reset 清除回复结束的延迟刷新', async () => {
    vi.useFakeTimers()
    const workspace = useWorkspace()
    await workspace.openWorkspace(1)
    const instance = workspace.chat.value as unknown as { options: { onFinish: (event: { isAbort: boolean }) => void } }
    instance.options.onFinish({ isAbort: false })
    workspace.resetWorkspace()
    mocks.plans.detail.mockClear()
    await vi.runAllTimersAsync()
    expect(mocks.plans.detail).not.toHaveBeenCalled()
  })
})

describe('持久化消息预览', () => {
  it('工具已携带相同版本预览时不重复追加 data-preview', () => {
    const preview = { planId: 1, version: 3 } as PlanPreview
    const records = [{ id: 1, role: 'assistant', content: '', toolCalls: [{ name: 'save_plan', output: { preview } }], preview }] as MessageRecord[]
    const message = toWorkbenchMessages(records)[0]!
    expect(message.parts.filter((part) => part.type === 'data-preview')).toHaveLength(0)
    expect(message.parts.filter((part) => part.type === 'tool-save_plan')).toHaveLength(1)
  })

  it('不同版本预览和没有工具的系统预览均保留', () => {
    const preview = { planId: 1, version: 3 } as PlanPreview
    const records = [{ id: 1, role: 'system', content: '', toolCalls: [{ name: 'save_plan', output: { preview: { ...preview, version: 2 } } }], preview }] as MessageRecord[]
    expect(toWorkbenchMessages(records)[0]!.parts.filter((part) => part.type === 'data-preview')).toHaveLength(1)
  })
})

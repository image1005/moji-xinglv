import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef, watch } from 'vue'
import type { MessageRecord, PlanPreview } from '../shared/types'
import type { PlanDetail } from '../app/utils/api'
import { useWorkspace } from '../app/composables/useWorkspace'
import { toWorkbenchMessages } from '../app/features/workspace/messages'
import type { Attachment } from '../shared/schemas/attachment'
import type { PlanResources } from '../shared/schemas/media'

const mocks = vi.hoisted(() => ({
  plans: { list: vi.fn(), listPage: vi.fn(), detail: vi.fn(), versions: vi.fn(), versionsPage: vi.fn(), create: vi.fn(), save: vi.fn(), switchVersion: vi.fn(), remove: vi.fn(), updateMeta: vi.fn() },
  conversations: { list: vi.fn(), listPage: vi.fn(), detail: vi.fn(), messagesPage: vi.fn(), create: vi.fn(), remove: vi.fn() },
  chatRuns: vi.fn(),
  cacheGet: vi.fn(), cacheSet: vi.fn(),
}))
vi.mock('~/utils/idb', () => ({ idbGet: mocks.cacheGet, idbSet: mocks.cacheSet }))

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
vi.mock('../app/utils/chat-transport', () => ({ JsonlChatTransport: class { constructor(public options: { body: () => unknown }) {} } }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function plan(id: number): PlanDetail {
  return { id, title: `规划 ${id}`, version: 1, revision: 4, plan: { title: `规划 ${id}`, days: [] } } as PlanDetail
}

let app: object
beforeEach(() => {
  vi.resetAllMocks()
  app = {}
  vi.stubGlobal('useNuxtApp', () => app)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  mocks.plans.list.mockResolvedValue([])
  mocks.plans.listPage.mockImplementation(async () => ({ items: await mocks.plans.list(), nextCursor: null, hasMore: false }))
  mocks.plans.detail.mockImplementation(async (id: number) => plan(id))
  mocks.plans.versions.mockResolvedValue([])
  mocks.plans.versionsPage.mockResolvedValue({ items: [], nextCursor: null, hasMore: false })
  mocks.chatRuns.mockResolvedValue([])
  mocks.cacheGet.mockResolvedValue(null)
  mocks.cacheSet.mockResolvedValue(undefined)
  mocks.conversations.list.mockResolvedValue([
    { id: 11, planId: 1, title: '会话一' },
    { id: 22, planId: 2, title: '会话二' },
  ])
  mocks.conversations.detail.mockImplementation(async (id: number) => ({ conversation: { id, planId: id === 11 ? 1 : 2 }, messages: [] }))
  mocks.conversations.listPage.mockImplementation(async (planId?: number) => ({ items: (await mocks.conversations.list()).filter((item: { planId: number }) => !planId || planId === item.planId), nextCursor: null, hasMore: false }))
  mocks.conversations.messagesPage.mockImplementation(async (id: number) => ({ ...await mocks.conversations.detail(id), messagePage: { nextCursor: null, hasMore: false } }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('工作区状态隔离与并发保护', () => {
  it('搜索首屏未完成时禁止携带旧游标加载更多，迟到旧响应也不能覆盖搜索', async () => {
    vi.useFakeTimers()
    const workspace = useWorkspace()
    mocks.plans.listPage.mockResolvedValueOnce({ items: [plan(1)], nextCursor: 'old-cursor', hasMore: true })
    await workspace.loadPlans()
    const fresh = deferred<{ items: PlanDetail[]; nextCursor: string; hasMore: boolean }>()
    mocks.plans.listPage.mockReturnValueOnce(fresh.promise)
    workspace.keyword.value = '杭州'
    expect(workspace.plansHasMore.value).toBe(false)
    await workspace.loadMorePlans()
    await vi.advanceTimersByTimeAsync(250)
    await workspace.loadMorePlans()
    expect(mocks.plans.listPage).toHaveBeenCalledTimes(2)
    expect(mocks.plans.listPage).toHaveBeenLastCalledWith(undefined, '杭州', 'updated')
    fresh.resolve({ items: [plan(2)], nextCursor: 'new-cursor', hasMore: true })
    await vi.advanceTimersByTimeAsync(0)
    mocks.plans.listPage.mockResolvedValueOnce({ items: [plan(3)], nextCursor: null, hasMore: false })
    await workspace.loadMorePlans()
    expect(mocks.plans.listPage).toHaveBeenLastCalledWith('new-cursor', '杭州', 'updated')
    expect(workspace.plans.value.map((item) => item.id)).toEqual([2, 3])
    workspace.resetWorkspace()
  })

  it('排序切换时禁止旧游标并在退出时取消待发搜索', async () => {
    vi.useFakeTimers()
    const workspace = useWorkspace()
    mocks.plans.listPage.mockResolvedValueOnce({ items: [plan(1)], nextCursor: 'updated-cursor', hasMore: true })
    await workspace.loadPlans()
    const fresh = deferred<{ items: PlanDetail[]; nextCursor: null; hasMore: boolean }>()
    mocks.plans.listPage.mockReturnValueOnce(fresh.promise)
    workspace.toggleSort()
    await workspace.loadMorePlans()
    expect(mocks.plans.listPage).toHaveBeenCalledTimes(2)
    expect(mocks.plans.listPage).toHaveBeenLastCalledWith(undefined, undefined, 'created')
    workspace.keyword.value = '待发搜索'
    workspace.resetWorkspace()
    fresh.resolve({ items: [plan(2)], nextCursor: null, hasMore: false })
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.plans.listPage).toHaveBeenCalledTimes(2)
    expect(workspace.plans.value).toEqual([])
  })

  it('搜索旧会话由服务端过滤且切换词后不继续旧会话游标', async () => {
    vi.useFakeTimers()
    const workspace = useWorkspace()
    workspace.keyword.value = '旧会话'
    mocks.conversations.listPage.mockResolvedValueOnce({ items: [], nextCursor: 'old-conversations', hasMore: true })
    await workspace.loadConversations(1)
    expect(mocks.conversations.listPage).toHaveBeenLastCalledWith(1, undefined, '旧会话')
    workspace.keyword.value = '另一个词'
    await workspace.loadMoreConversations(1)
    expect(mocks.conversations.listPage).toHaveBeenCalledTimes(1)
    expect(workspace.isConversationsLoaded(1)).toBe(false)
    workspace.resetWorkspace()
  })

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
    expect(mocks.plans.save).toHaveBeenCalledWith(2, { planJson: undefined, expectedVersion: 7, expectedRevision: 4, conversationId: undefined })
    expect(workspace.mainMode.value).toBe('plan')
  })

  it('元数据更新按第二参数、patch 版本、当前版本的优先级发送前提', async () => {
    const workspace = useWorkspace()
    await workspace.openPlanView(1)
    await workspace.updatePlanMeta({ title: '新标题' })
    expect(mocks.plans.updateMeta).toHaveBeenLastCalledWith(1, { title: '新标题', expectedVersion: 1, expectedRevision: 4 })
    await workspace.updatePlanMeta({ title: '新标题', expectedVersion: 5 })
    expect(mocks.plans.updateMeta).toHaveBeenLastCalledWith(1, { title: '新标题', expectedVersion: 5, expectedRevision: 4 })
    await workspace.updatePlanMeta({ title: '新标题', expectedVersion: 5 }, 7)
    expect(mocks.plans.updateMeta).toHaveBeenLastCalledWith(1, { title: '新标题', expectedVersion: 7, expectedRevision: 4 })
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

  it('同规划查看总览/设置/原会话不中止生成且保留Chat实例', async () => {
    const workspace = useWorkspace()
    await workspace.openWorkspace(1)
    const instance = workspace.chat.value!
    await workspace.openPlanView(1)
    workspace.openSettings()
    await workspace.openConversation(11)
    expect(workspace.chat.value).toBe(instance)
    expect(instance.stop).not.toHaveBeenCalled()
    expect(workspace.mainMode.value).toBe('chat')
  })

  it('保存只对账当前规划和消息，不重新拉取全账号列表', async () => {
    const workspace = useWorkspace()
    await workspace.openWorkspace(1)
    mocks.plans.listPage.mockClear()
    mocks.conversations.listPage.mockClear()
    mocks.plans.detail.mockClear()
    mocks.conversations.messagesPage.mockClear()
    await workspace.savePlan(undefined, 1, 3)
    expect(mocks.plans.save).toHaveBeenCalledWith(1, expect.objectContaining({ expectedRevision: 3 }))
    expect(mocks.plans.listPage).not.toHaveBeenCalled()
    expect(mocks.conversations.listPage).not.toHaveBeenCalled()
    expect(mocks.plans.detail).toHaveBeenCalledTimes(1)
    expect(mocks.conversations.messagesPage).toHaveBeenCalledTimes(1)
  })

  it('网络失败可显示身份隔离快照，但拒绝离线保存；权限失败不退回缓存', async () => {
    mocks.cacheGet.mockResolvedValue(plan(1))
    mocks.plans.detail.mockRejectedValue(new Error('网络断开'))
    const workspace = useWorkspace()
    await workspace.openPlanView(1)
    expect(workspace.offline.value).toBe(true)
    expect(await workspace.savePlan()).toBeNull()
    expect(mocks.plans.save).not.toHaveBeenCalled()
    workspace.resetWorkspace()
    mocks.plans.detail.mockRejectedValue(Object.assign(new Error('拒绝访问'), { statusCode: 403 }))
    await workspace.openPlanView(1)
    expect(workspace.offline.value).toBe(false)
    expect(workspace.errorMessage.value).toContain('拒绝访问')
  })

  it('向前分页保留消息顺序与已有消息且不重复', async () => {
    const workspace = useWorkspace()
    mocks.conversations.messagesPage.mockResolvedValueOnce({ conversation: { id: 11, planId: 1 }, messages: [{ id: 3, role: 'user', content: '三' }], messagePage: { nextCursor: 'older', hasMore: true } })
    await workspace.openWorkspace(1)
    mocks.conversations.messagesPage.mockResolvedValueOnce({ conversation: { id: 11, planId: 1 }, messages: [{ id: 1, role: 'user', content: '一' }, { id: 2, role: 'assistant', content: '二' }, { id: 3, role: 'user', content: '三' }], messagePage: { nextCursor: null, hasMore: false } })
    await workspace.loadOlderMessages()
    expect(workspace.chat.value?.messages.map((item) => item.id)).toEqual(['db-1', 'db-2', 'db-3'])
    expect(workspace.messagesHasMore.value).toBe(false)
  })

  it('跨设备新增超过一页时重置分页游标，避免中间历史永远缺失', async () => {
    const workspace = useWorkspace()
    mocks.conversations.messagesPage.mockResolvedValueOnce({ conversation: { id: 11, planId: 1 }, messages: [{ id: 100, role: 'user', content: '旧页' }], messagePage: { nextCursor: 'before-100', hasMore: true } })
    await workspace.openWorkspace(1)
    mocks.conversations.messagesPage.mockResolvedValueOnce({ conversation: { id: 11, planId: 1 }, messages: [{ id: 170, role: 'user', content: '新页' }], messagePage: { nextCursor: 'before-170', hasMore: true } })
    await workspace.reloadConversation()
    expect(workspace.chat.value?.messages.map((message) => message.id)).toEqual(['db-170'])
    mocks.conversations.messagesPage.mockResolvedValueOnce({ conversation: { id: 11, planId: 1 }, messages: [{ id: 150, role: 'user', content: '中间记录' }], messagePage: { nextCursor: null, hasMore: false } })
    await workspace.loadOlderMessages()
    expect(mocks.conversations.messagesPage).toHaveBeenLastCalledWith(11, 'before-170')
    expect(workspace.chat.value?.messages.map((message) => message.id)).toEqual(['db-150', 'db-170'])
  })

  it('离线版本加载明确返回false，调用方可停止历史遍历', async () => {
    const workspace = useWorkspace()
    workspace.currentPlan.value = plan(1)
    workspace.offline.value = true
    expect(await workspace.loadVersions(true)).toBe(false)
    expect(mocks.plans.versionsPage).not.toHaveBeenCalled()
  })
})

describe('持久化消息预览', () => {
  it('图片历史恢复为SDK文件part而不写入普通文本', () => {
    const records = [{ id: 8, role: 'user', content: '', parts: [{ type: 'file', url: '/api/attachments/123', mediaType: 'image/png', filename: '攻略.png' }] }] as MessageRecord[]
    const message = toWorkbenchMessages(records)[0]!
    expect(message.parts).toEqual([{ type: 'file', url: '/api/attachments/123', mediaType: 'image/png', filename: '攻略.png' }])
    expect(message.parts.some(part => part.type === 'text')).toBe(false)
  })
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

describe('图片发送与本轮配置身份', () => {
  const photo = (id: string): Attachment => ({ id, url: `/api/attachments/${id}`, mediaType: 'image/png', filename: '照片.png', size: 80, width: 8, height: 8 })
  async function prepared() {
    const workspace = useWorkspace()
    await workspace.openWorkspace(1)
    workspace.modelSettings.configuration.value = { model: 'vision', webSearch: false, thinking: 'off' }
    workspace.modelSettings.capabilities.value = { model: 'vision', provider: 'test', vision: true, tools: true, thinkingLevels: ['off', 'standard'], search: { available: true, provider: 'Tavily', native: false }, verification: 'configured' }
    return workspace
  }
  it('允许纯图片发送并将真实文件part交给SDK', async () => {
    const workspace = await prepared()
    await workspace.sendMessage('', [photo('one')])
    expect(workspace.chat.value!.sendMessage).toHaveBeenCalledWith({ parts: [{ type: 'file', url: '/api/attachments/one', mediaType: 'image/png', filename: '照片.png' }] })
  })
  it('相同失败需求复用请求身份，但改变附件或实际配置会创建新身份', async () => {
    const workspace = await prepared()
    const instance = workspace.chat.value!
    const transport = (instance as unknown as { options: { transport: { options: { body: () => { requestId: string; configuration: unknown } } } } }).options.transport
    const identities: string[] = []
    vi.mocked(instance.sendMessage).mockImplementation(async () => {
      identities.push(transport.options.body().requestId)
      throw new Error('断开连接')
    })
    await workspace.sendMessage('杭州', [photo('one')])
    await workspace.sendMessage('杭州', [photo('one')])
    await workspace.sendMessage('杭州', [photo('two')])
    await workspace.sendMessage('杭州', [photo('two')], { model: 'vision', webSearch: true, thinking: 'standard' })
    expect(identities[0]).toBe(identities[1])
    expect(new Set(identities).size).toBe(3)
    expect(transport.options.body().configuration).toEqual({ model: 'vision', webSearch: true, thinking: 'standard' })
  })
  it('不支持视觉的模型拒绝图片且不静默退化成文字', async () => {
    const workspace = await prepared()
    workspace.modelSettings.capabilities.value!.vision = false
    expect(await workspace.sendMessage('', [photo('one')])).toBeNull()
    expect(workspace.chat.value!.sendMessage).not.toHaveBeenCalled()
    expect(workspace.errorMessage.value).toContain('不支持图片')
  })
})

describe('渐进资源与隔离', () => {
  const resourcePage = (count: number): PlanResources => ({ revision: 4, resources: Array.from({ length: count }, (_, index) => ({ entityId: `spot:${index}`, entityType: 'spot', name: `景点${index}`, city: '杭州', status: 'pending', image: null, location: null, error: null })) })
  it('分批继续补充第13个资源，并发不超过2且不自动重试失败资源', async () => {
    const workspace = useWorkspace()
    const page = resourcePage(15)
    workspace.planResources.records.value[1] = structuredClone(page)
    let active = 0, maximum = 0
    const requested: string[] = []
    vi.stubGlobal('$fetch', vi.fn(async (_path: string, options: { body: { entityId: string } }) => {
      active++; maximum = Math.max(maximum, active)
      requested.push(options.body.entityId)
      await Promise.resolve()
      const item = page.resources.find(item => item.entityId === options.body.entityId)!
      item.status = item.entityId === 'spot:0' ? 'failed' : 'ready'
      active--
      return structuredClone(page)
    }))
    await workspace.planResources.enrich(1, 4)
    expect(requested).toHaveLength(15)
    expect(new Set(requested).size).toBe(15)
    expect(maximum).toBeLessThanOrEqual(2)
    expect(workspace.planResources.records.value[1]!.resources[0]!.status).toBe('failed')
    expect(workspace.planResources.records.value[1]!.resources[12]!.status).toBe('ready')
    await workspace.planResources.enrich(1, 4)
    expect(requested).toHaveLength(16)
    expect(requested.at(-1)).toBe('spot:0')
  })
  it('退出后迟到的资源结果不能填充另一用户状态', async () => {
    const workspace = useWorkspace()
    const response = deferred<PlanResources>()
    vi.stubGlobal('$fetch', vi.fn(() => response.promise))
    const pending = workspace.planResources.load(1, 4)
    workspace.resetWorkspace()
    response.resolve(resourcePage(1))
    await pending
    expect(workspace.planResources.records.value).toEqual({})
  })

  it('HTTP 失败后手动继续会重试已经尝试过的 pending 资源', async () => {
    const workspace = useWorkspace()
    const page = resourcePage(1)
    workspace.planResources.records.value[1] = page
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...page, resources: [{ ...page.resources[0], status: 'ready' }] })
    vi.stubGlobal('$fetch', fetcher)
    await workspace.planResources.enrich(1, 4)
    expect(workspace.planResources.failures.value[1]).toBeTruthy()
    await workspace.planResources.enrich(1, 4)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(workspace.planResources.records.value[1]!.resources[0]!.status).toBe('ready')
    expect(workspace.planResources.failures.value[1]).toBe('')
  })
})

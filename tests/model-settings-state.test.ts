import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelCapabilities, ModelConfiguration } from '../shared/schemas/model-config'
import { createModelSettings } from '../app/features/workspace/model-settings'

vi.mock('~/utils/api', () => ({ apiErrorMessage: (error: Error) => error.message }))

const caps: ModelCapabilities = {
  model: 'deepseek-flash', provider: 'deepseek', vision: false, tools: true,
  thinkingLevels: ['off', 'light', 'standard', 'deep'],
  search: { available: true, provider: 'Tavily', native: false }, verification: 'documented',
}
function settings(thinking: ModelConfiguration['thinking'] = 'off', webSearch = false) {
  return { defaults: { model: caps.model, thinking, webSearch }, capabilities: structuredClone(caps) }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
afterEach(() => { vi.unstubAllGlobals() })

describe('模型配置选择、持久化与本轮快照', () => {
  it.each(['off', 'light', 'standard', 'deep'] as const)('%s 与搜索独立组合，刷新后恢复服务端保存结果', async thinking => {
    let persisted = settings()
    const fetch = vi.fn(async (_url: string, options?: { body: ModelConfiguration }) => {
      if (options) persisted = { defaults: options.body, capabilities: caps }
      return structuredClone(persisted)
    })
    vi.stubGlobal('$fetch', fetch)
    const state = createModelSettings()
    await state.load()
    state.update({ thinking })
    state.update({ webSearch: true })
    await vi.waitFor(() => expect(state.saving.value).toBe(false))
    expect(state.configuration.value).toMatchObject({ thinking, webSearch: true })
    const reloaded = createModelSettings()
    await reloaded.load()
    expect(reloaded.configuration.value).toEqual(state.configuration.value)
    state.update({ webSearch: false })
    await vi.waitFor(() => expect(state.saving.value).toBe(false))
    expect(state.configuration.value).toMatchObject({ thinking, webSearch: false })
    expect(persisted.defaults).toMatchObject({ thinking, webSearch: false })
  })

  it('连续切换时旧保存响应不会覆盖最新选择，本轮快照不随之后的配置变化', async () => {
    const firstSave = deferred<ReturnType<typeof settings>>()
    const fetch = vi.fn().mockResolvedValueOnce(settings()).mockReturnValueOnce(firstSave.promise)
      .mockImplementation(async (_url: string, options: { body: ModelConfiguration }) => ({ defaults: options.body, capabilities: caps }))
    vi.stubGlobal('$fetch', fetch)
    const state = createModelSettings()
    await state.load()
    state.update({ thinking: 'deep' })
    const turn = await state.snapshot()
    state.update({ webSearch: true })
    expect(state.saving.value).toBe(true)
    expect(state.configuration.value).toMatchObject({ thinking: 'deep', webSearch: true })
    expect(turn).toMatchObject({ thinking: 'deep', webSearch: false })
    firstSave.resolve(settings('deep'))
    await vi.waitFor(() => expect(state.saving.value).toBe(false))
    expect(state.configuration.value).toMatchObject({ thinking: 'deep', webSearch: true })
    expect(turn.webSearch).toBe(false)
    expect(fetch.mock.calls.filter(call => call[1]).map(call => call[1].body)).toEqual([
      { model: caps.model, thinking: 'deep', webSearch: false },
      { model: caps.model, thinking: 'deep', webSearch: true },
    ])
  })

  it('保存失败保留明确选择与错误，重试同一选择成功后刷新恢复', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(settings()).mockRejectedValueOnce(new Error('网络连接失败'))
      .mockResolvedValue(settings('deep', true))
    vi.stubGlobal('$fetch', fetch)
    const state = createModelSettings()
    await state.load()
    state.update({ thinking: 'deep', webSearch: true })
    await vi.waitFor(() => expect(state.saving.value).toBe(false))
    expect(state.failure.value).toBe('网络连接失败')
    expect(await state.snapshot()).toMatchObject({ thinking: 'deep', webSearch: true })
    state.update({})
    await vi.waitFor(() => expect(state.saving.value).toBe(false))
    expect(state.failure.value).toBe('')
    const reloaded = createModelSettings()
    await reloaded.load()
    expect(reloaded.configuration.value).toMatchObject({ thinking: 'deep', webSearch: true })
  })

  it('不支持的档位及搜索不能写入配置或请求快照，能力变更原因持续展示', async () => {
    const supported = settings()
    supported.capabilities.thinkingLevels = ['off']
    supported.capabilities.search.available = false
    const fetch = vi.fn().mockResolvedValue({ ...supported, adjustmentReason: '原深度思考默认值不再受当前模型支持，已恢复为关闭' })
    vi.stubGlobal('$fetch', fetch)
    const state = createModelSettings()
    await state.load()
    state.update({ thinking: 'deep' })
    state.update({ webSearch: true })
    expect(await state.snapshot()).toMatchObject({ thinking: 'off', webSearch: false })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(state.adjustmentReason.value).toContain('原深度思考')
  })

  it('退出后迟到的配置响应不会泄漏到下一个账号', async () => {
    const oldSave = deferred<ReturnType<typeof settings>>()
    const fetch = vi.fn().mockResolvedValueOnce(settings()).mockReturnValueOnce(oldSave.promise).mockResolvedValue(settings('light'))
    vi.stubGlobal('$fetch', fetch)
    const state = createModelSettings()
    await state.load()
    state.update({ thinking: 'deep' })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    state.reset()
    await state.load()
    oldSave.resolve(settings('deep'))
    await Promise.resolve()
    expect(state.configuration.value?.thinking).toBe('light')
    expect(state.saving.value).toBe(false)
    expect(state.failure.value).toBe('')
  })
})

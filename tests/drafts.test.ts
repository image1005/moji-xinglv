import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, shallowRef, watch } from 'vue'
import { draftKey, readDraft, writeDraft } from '../app/utils/draft-storage'
import { mergeDraftFields } from '../app/utils/draft-merge'
import { useBoundPlan, usePlanDraft } from '../app/composables/usePlanDraft'

vi.mock('~/utils/draft-storage', () => import('../app/utils/draft-storage'))

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}
type Draft = { text: string; revision: number }
function validate(value: unknown): Draft | null {
  const draft = value as Draft | null
  return draft && typeof draft.text === 'string' && Number.isInteger(draft.revision) ? draft : null
}
const user = ref<{ id: string } | null>({ id: 'a' })
const currentPlan = ref<{ id: number; revision: number } | null>({ id: 1, revision: 1 })
let scope = effectScope()
beforeEach(() => {
  vi.useFakeTimers()
  user.value = { id: 'a' }
  currentPlan.value = { id: 1, revision: 1 }
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('useCurrentUser', () => ({ user }))
  vi.stubGlobal('useWorkspace', () => ({ currentPlan }))
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('onMounted', vi.fn())
  vi.stubGlobal('onBeforeUnmount', vi.fn())
  vi.stubGlobal('onDeactivated', vi.fn())
  scope = effectScope()
})
afterEach(() => { scope.stop(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('可恢复且隔离的行程草稿', () => {
  it('按用户、规划和编辑对象隔离，刷新恢复时仍保留旧修订基线', () => {
    const first = scope.run(() => usePlanDraft(1, 'spot:0:1', validate))!
    first.save({ text: '未保存的地点', revision: 7 })
    first.flush()
    const refresh = scope.run(() => usePlanDraft(1, 'spot:0:1', validate))!
    expect(refresh.restore()).toEqual({ text: '未保存的地点', revision: 7 })
    expect(scope.run(() => usePlanDraft(2, 'spot:0:1', validate))!.restore()).toBeNull()
    expect(scope.run(() => usePlanDraft(1, 'spot:0:2', validate))!.restore()).toBeNull()
    user.value = { id: 'b' }
    expect(scope.run(() => usePlanDraft(1, 'spot:0:1', validate))!.restore()).toBeNull()
    expect(first.restore()).toBeNull()
  })

  it('A → B → A 不会丢弃 A 草稿，退出后旧实例不能写入新用户草稿', () => {
    const first = scope.run(() => usePlanDraft(1, 'map', validate))!
    first.save({ text: 'A 的草稿', revision: 3 })
    vi.advanceTimersByTime(250)
    const second = scope.run(() => usePlanDraft(2, 'map', validate))!
    second.save({ text: 'B 的草稿', revision: 4 })
    second.flush()
    expect(first.restore()?.text).toBe('A 的草稿')
    user.value = null
    first.save({ text: '迟到的更新', revision: 3 })
    first.flush()
    user.value = { id: 'a' }
    expect(first.restore()?.text).toBe('A 的草稿')
  })

  it('KeepAlive 中的旧视图不跟随其他规划，账号变化立即隐藏旧数据', () => {
    const plan = scope.run(useBoundPlan)!
    currentPlan.value = { id: 2, revision: 9 }
    expect(plan.value).toEqual({ id: 1, revision: 1 })
    currentPlan.value = { id: 1, revision: 2 }
    expect(plan.value?.revision).toBe(2)
    user.value = { id: 'b' }
    expect(plan.value).toBeNull()
  })

  it('存储失败会显示未持久化，过期或损坏草稿不会恢复', () => {
    const storage = memoryStorage()
    const key = draftKey('a', 1, 'map')
    writeDraft(storage, key, { text: '草稿', revision: 1 })
    vi.advanceTimersByTime(31 * 24 * 3600 * 1000)
    expect(readDraft(storage, key, validate)).toBeNull()
    storage.setItem(key, '{broken')
    expect(readDraft(storage, key, validate)).toBeNull()
    vi.stubGlobal('localStorage', { ...storage, setItem: () => { throw new Error('QuotaExceeded') } })
    const draft = scope.run(() => usePlanDraft(1, 'map', validate))!
    draft.save({ text: '尚在内存', revision: 1 })
    draft.flush()
    expect(draft.persisted.value).toBe(false)
    expect(draft.storageError.value).toContain('无法保存')
  })

  it('明确重放草稿时只应用本地改动，保留最新内容中的无关修改', () => {
    const result = mergeDraftFields(
      { name: '旧名称', notes: '旧备注', cost: '10' },
      { name: '我的名称', notes: '旧备注', cost: '10' },
      { name: '他人名称', notes: '新增预约要求', cost: '25' },
      { name: '地点名称' },
    )
    expect(result.merged).toEqual({ name: '我的名称', notes: '新增预约要求', cost: '25' })
    expect(result.differences).toEqual([{ label: '地点名称', current: '他人名称', draft: '我的名称' }])
  })
})

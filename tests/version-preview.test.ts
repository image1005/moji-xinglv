import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'
import { emptyPlan } from '../shared/schemas/plan'
import { createVersionPreview, watchVersionSelection } from '../app/utils/version-preview'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('historical version preview requests', () => {
  it('does not reload when Vue receives replacement metadata for the same selected version', async () => {
    const props = reactive({ planId: 1, version: { version: 2, name: '原名称', nameRevision: 0 } })
    const scope = effectScope()
    const selections: string[] = []
    scope.run(() => watchVersionSelection(() => props.planId, () => props.version.version, () => {
      selections.push(`${props.planId}:${props.version.version}`)
    }))
    try {
      expect(selections).toEqual(['1:2'])
      // Both initial metadata refresh and a successful rename replace this prop.
      props.version = { version: 2, name: '刷新名称', nameRevision: 1 }
      await nextTick()
      props.version = { version: 2, name: '新保存名称', nameRevision: 2 }
      await nextTick()
      expect(selections).toEqual(['1:2'])
      props.version = { version: 3, name: '另一版本', nameRevision: 0 }
      await nextTick()
      props.planId = 9
      await nextTick()
      expect(selections).toEqual(['1:2', '1:3', '9:3'])
    } finally { scope.stop() }
  })

  it('keeps the final selection when version responses arrive out of order', async () => {
    const older = deferred<{ plan: ReturnType<typeof emptyPlan> }>()
    const newer = deferred<{ plan: ReturnType<typeof emptyPlan> }>()
    const state = createVersionPreview((_id, version) => version === 1 ? older.promise : newer.promise)
    const first = state.load(1, 1)
    const last = state.load(1, 2)
    newer.resolve({ plan: emptyPlan('第二版快照') })
    await last
    older.resolve({ plan: emptyPlan('旧版晚到') })
    await first
    expect(state.plan.value?.title).toBe('第二版快照')
    expect(state.loading.value).toBe(false)
    expect(state.error.value).toBeNull()
  })

  it('clears a previous workspace snapshot and ignores its late error', async () => {
    const late = deferred<{ plan: ReturnType<typeof emptyPlan> }>()
    const state = createVersionPreview((id) => id === 1 ? late.promise : Promise.resolve({ plan: emptyPlan('另一工作区') }))
    const first = state.load(1, 1)
    await state.load(2, 1)
    late.reject(new Error('旧工作区已删除'))
    await first
    expect(state.plan.value?.title).toBe('另一工作区')
    expect(state.error.value).toBeNull()
  })

  it('does not finish loading when an obsolete response arrives before the active one', async () => {
    const older = deferred<{ plan: ReturnType<typeof emptyPlan> }>()
    const newer = deferred<{ plan: ReturnType<typeof emptyPlan> }>()
    const state = createVersionPreview((_id, version) => version === 1 ? older.promise : newer.promise)
    const first = state.load(1, 1)
    const last = state.load(1, 2)
    older.resolve({ plan: emptyPlan('旧版') })
    await first
    expect(state.loading.value).toBe(true)
    expect(state.plan.value).toBeNull()
    newer.resolve({ plan: emptyPlan('新版') })
    await last
    expect(state.plan.value?.title).toBe('新版')
  })

  it('invalidates pending work when the dialog closes', async () => {
    const pending = deferred<{ plan: ReturnType<typeof emptyPlan> }>()
    const state = createVersionPreview(() => pending.promise)
    const request = state.load(1, 1)
    state.invalidate()
    pending.resolve({ plan: emptyPlan('关闭后到达') })
    await request
    expect(state.plan.value).toBeNull()
    expect(state.loading.value).toBe(false)
    expect(state.error.value).toBeNull()
  })

  it('supports failure, retry and an explicitly empty snapshot', async () => {
    let attempts = 0
    const state = createVersionPreview(async () => {
      if (++attempts === 1) throw new Error('读取失败')
      return { plan: null }
    })
    await state.load(1, 1)
    expect(state.error.value).toBeInstanceOf(Error)
    expect(state.loading.value).toBe(false)
    await state.load(1, 1)
    expect(state.error.value).toBeNull()
    expect(state.plan.value).toBeNull()
    expect(state.loading.value).toBe(false)
  })
})

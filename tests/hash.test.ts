import { describe, expect, it } from 'vitest'
import { hashKey } from '#shared/utils/hash'

describe('hashKey', () => {
  it('参数顺序无关', async () => {
    const a = await hashKey('panorama/v2', { lng: 120.1, lat: 30.2, width: 512 })
    const b = await hashKey('panorama/v2', { width: 512, lat: 30.2, lng: 120.1 })
    expect(a).toBe(b)
  })

  it('不同 api 或参数生成不同 key', async () => {
    const a = await hashKey('panorama/v2', { lng: 120.1 })
    const b = await hashKey('staticimage/v2', { lng: 120.1 })
    const c = await hashKey('panorama/v2', { lng: 120.2 })
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('快照固定格式（64 位 hex）', async () => {
    const key = await hashKey('cache/test', { a: 1, b: [1, 2] })
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(key).toMatchInlineSnapshot(`"1a3c753dd658b4a6abac83a9ec9a2a3fedc49aa33300cc7cda911ae4cdfa7ab7"`)
  })
})

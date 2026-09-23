import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type User = { id: string; role: 'user' | 'admin' }
type Guard = (to: { fullPath: string }) => Promise<unknown>
type Destination = string | { path: string; query: { redirect: string } }

const loadMe = vi.fn<(force?: boolean) => Promise<User | null>>()
const navigate = vi.fn((destination: Destination) => destination)
let cachedUser: User | null
let serverUser: User | null

beforeEach(() => {
  vi.resetAllMocks()
  cachedUser = null
  serverUser = null
  // A successful earlier lookup can still hold null, or a previous account's role.
  loadMe.mockImplementation(async (force = false) => force ? serverUser : cachedUser)
  navigate.mockImplementation((destination: Destination) => destination)
  vi.stubGlobal('defineNuxtRouteMiddleware', (guard: Guard) => guard)
  vi.stubGlobal('useCurrentUser', () => ({ user: { value: cachedUser }, loadMe }))
  vi.stubGlobal('navigateTo', navigate)
})

afterEach(() => vi.unstubAllGlobals())

async function middleware(name: 'auth' | 'admin'): Promise<Guard> {
  const module = name === 'auth'
    ? await import('../app/middleware/auth')
    : await import('../app/middleware/admin')
  return module.default as unknown as Guard
}

describe('路由守卫使用本次身份结果决定访问权限', () => {
  it.each(['auth', 'admin'] as const)('%s 未登录时返回登录页并保留完整目标', async (name) => {
    const fullPath = name === 'auth' ? '/?plan=12#day-2' : '/admin?tab=cache'
    const destination = { path: '/login', query: { redirect: fullPath } }

    await expect((await middleware(name))({ fullPath })).resolves.toEqual(destination)
    expect(navigate).toHaveBeenCalledExactlyOnceWith(destination)
  })

  it('普通用户登录后可进入工作台，即使旧身份缓存为空', async () => {
    serverUser = { id: 'traveler', role: 'user' }

    await expect((await middleware('auth'))({ fullPath: '/' })).resolves.toBeUndefined()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('普通用户不能进入管理页，即使旧缓存仍是管理员', async () => {
    cachedUser = { id: 'previous-admin', role: 'admin' }
    serverUser = { id: 'traveler', role: 'user' }

    await expect((await middleware('admin'))({ fullPath: '/admin' })).resolves.toBe('/')
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/')
  })

  it('当前管理员可进入管理页', async () => {
    serverUser = { id: 'current-admin', role: 'admin' }

    await expect((await middleware('admin'))({ fullPath: '/admin' })).resolves.toBeUndefined()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('身份请求未完成时等待，不因旧空缓存提前跳回登录页', async () => {
    let resolveIdentity!: (user: User | null) => void
    loadMe.mockReturnValue(new Promise<User | null>((resolve) => { resolveIdentity = resolve }))
    const guard = await middleware('auth')
    let settled = false
    const pending = guard({ fullPath: '/' }).then((result) => { settled = true; return result })

    await Promise.resolve()
    expect(settled).toBe(false)
    expect(navigate).not.toHaveBeenCalled()

    resolveIdentity({ id: 'signed-in-user', role: 'user' })
    await expect(pending).resolves.toBeUndefined()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('管理员会话已失效时拒绝访问，不沿用旧管理员缓存', async () => {
    cachedUser = { id: 'expired-admin', role: 'admin' }
    const destination = { path: '/login', query: { redirect: '/admin' } }

    await expect((await middleware('admin'))({ fullPath: '/admin' })).resolves.toEqual(destination)
    expect(navigate).toHaveBeenCalledExactlyOnceWith(destination)
  })
})

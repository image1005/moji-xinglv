import { describe, expect, it } from 'vitest'
import { readAuthEnv, readSeedAdminEnv } from '../server/utils/env'

describe('鉴权与种子环境配置', () => {
  it('开发环境可缺省但显式管理员密码优先', () => {
    expect(readAuthEnv({}).secret.length).toBeGreaterThanOrEqual(32)
    expect(readSeedAdminEnv({ SEED_ADMIN_PASSWORD: 'explicit-password' }).password).toBe('explicit-password')
  })
  it('生产拒绝缺失、过短或开发鉴权密钥', () => {
    const base = { NODE_ENV: 'production', BETTER_AUTH_URL: 'https://example.test' }
    expect(() => readAuthEnv(base)).toThrow()
    expect(() => readAuthEnv({ ...base, AUTH_SECRET: 'short' })).toThrow()
    expect(() => readAuthEnv({ ...base, AUTH_SECRET: readAuthEnv({}).secret })).toThrow()
  })
  it('生产要求有效的服务地址与管理员显式密码', () => {
    expect(() => readAuthEnv({ NODE_ENV: 'production', AUTH_SECRET: 'x'.repeat(40) })).toThrow()
    expect(() => readAuthEnv({ NODE_ENV: 'production', AUTH_SECRET: 'x'.repeat(40), BETTER_AUTH_URL: 'file:///tmp/app' })).toThrow()
    expect(readAuthEnv({ NODE_ENV: 'production', AUTH_SECRET: 'x'.repeat(40), BETTER_AUTH_URL: 'https://example.test' }).baseURL).toBe('https://example.test')
    expect(() => readSeedAdminEnv({ NODE_ENV: 'production' })).toThrow()
    expect(() => readSeedAdminEnv({ NODE_ENV: 'production', SEED_ADMIN_PASSWORD: 'admin123456' })).toThrow()
    expect(readSeedAdminEnv({ NODE_ENV: 'production', SEED_ADMIN_PASSWORD: 'explicit-strong-password' }).password).toBe('explicit-strong-password')
  })
})

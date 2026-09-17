import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('WAL 一致性备份与恢复演练保留源库、拒绝覆盖并校验关键表', () => {
  const result = spawnSync('bun', ['run', fileURLToPath(new URL('./backup.fixture.ts', import.meta.url))], {
    encoding: 'utf8', timeout: 20000, env: { ...process.env, DATABASE_URL: '禁止连接真实数据库' },
  })
  expect(result.error, result.error?.message).toBeUndefined()
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  expect(result.stdout).not.toContain('secret fixture')
  expect(result.stdout).not.toContain('private fixture')
})

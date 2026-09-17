import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.each([
  ['identity', '同一请求完成、停止与中断后都不能重复执行，且身份隔离'],
  ['queue', '全局并发和用户并发限制、队列满、等待释放'],
  ['quota', '持久周期额度和 Retry-After'],
  ['checkpointRecovery', '工具提交后进程中断恢复预览，检查点不破坏版本'],
  ['metrics', '一次外部成功、两次缓存命中和一次失败可对账'],
  ['initialRequirements', '长会话保留最早需求的来源且跨用户不可读取'],
])('%s：%s', name => {
  const result = spawnSync('bun', ['run', fileURLToPath(new URL('./chat-runs.fixture.ts', import.meta.url)), name], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, DATABASE_URL: '禁止连接真实数据库' },
  })
  expect(result.error, result.error?.message).toBeUndefined()
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})

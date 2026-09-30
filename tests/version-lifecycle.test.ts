import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.each([
  ['finalOnly', '同轮多次工具修改仅终态提交，重试和迟到工具不改变正式历史'],
  ['noChange', '首次无变化不建草稿，最终还原父内容不建版本，重复保存不刷消息'],
  ['incomplete', '失败、取消、超时和重启保留成功快照与可恢复部分，终态竞争首个胜出'],
  ['restoreAndRetry', '恢复验证用户和规划作用域，恢复重试不覆盖后来独立编辑'],
  ['concurrentManualAndFork', '并发手工保存和版本切换不被AI完成覆盖，恢复支持历史分叉'],
  ['restoreNoop', '恢复同样内容跳过版本与系统消息'],
  ['rollback', '草稿预览、终态提交和恢复通知失败均回滚事务'],
  ['http', '真实H3路由验证草稿列表详情恢复、权限参数与完整恢复闭环'],
  ['migration', '旧数据库真实迁移保留全部历史分叉、快照和revision且可重复执行'],
])('%s：%s', name => {
  const result = spawnSync('bun', ['run', fileURLToPath(new URL('./version-lifecycle.fixture.ts', import.meta.url)), name], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, DATABASE_URL: '禁止连接真实数据库', AI_API_KEY: '' },
  })
  expect(result.error, result.error?.message).toBeUndefined()
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})

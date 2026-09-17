import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.each([
  ['mixedEditsRevision', '混用工具复用同轮版本、revision 检测旧快照且无变化跳过'],
  ['messageAtomic', 'AI 预览与版本原子提交并验证消息作用域'],
  ['systemAtomic', '手工保存和切换的通知失败撤销全部写入'],
  ['revisionMetadataAndSwitch', '修订号覆盖正文和指针变化并避免无变化递增'],
  ['pageMessages', '一千条消息分页无遗漏和重复并拒绝非法作用域'],
  ['pageVersions', '五百个版本完整分页并拒绝跨规划游标'],
  ['pageLists', '规划与会话列表使用稳定游标且隔离用户'],
  ['pageSearchSort', '全局规划和旧会话搜索分页保持过滤排序作用域'],
  ['cacheCapacity', '缓存容量与过期分批回收同步清理L1且不影响规划'],
])('%s：%s', (name) => {
  const result = spawnSync('bun', ['run', fileURLToPath(new URL('./backend-persistence.fixture.ts', import.meta.url)), name], {
    encoding: 'utf8', timeout: 20000, env: { ...process.env, DATABASE_URL: '禁止连接真实数据库' },
  })
  expect(result.error, result.error?.message).toBeUndefined()
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})

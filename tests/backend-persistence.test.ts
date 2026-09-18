import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// Vitest 使用 Node worker；SQLite 服务只在独立 Bun 进程的内存连接上执行。
it.each([
  ['locationEvidence', '模型新坐标被拒绝，手工确认坐标仍可保存与复用'],
  ['createRollback', '创建初始版本失败时回滚规划'],
  ['commitRollback', '更新规划失败时回滚新版本'],
  ['concurrentCas', '并发 CAS 只接受一个写入并拒绝陈旧保存与切换'],
  ['serialPatches', '无显式版本的并发 patch 不丢失彼此字段'],
  ['metadataSwitch', '元数据与 JSON 和版本一致并支持指针式切换'],
  ['switchBranches', '切换版本不新建版本并在继续编辑时形成分叉'],
  ['applyEditsTurn', '原子编辑可跨调用合并为单版本并在指针移动后追加'],
  ['unknownFieldRejected', '未知字段被拒绝且不产生版本'],
  ['metaExtensions', '封面标签提示预算扩展可往返且无变化不追加版本'],
  ['scope', '拒绝跨用户规划与跨规划父版本'],
  ['agentsScope', 'AGENTS 校验作用域和长度并串行保存全局版本'],
  ['recentMessages', '读取最近二百条消息并按稳定时间顺序返回'],
  ['cachePrefix', '两级缓存只删除字面前缀且保留其他条目'],
  ['binaryCache', '二进制缓存优先L1并校验过期和回填持久化命中'],
  ['seedIdempotent', '种子重复执行不重复数据且修复角色与全局偏好并隐藏密码'],
])('%s：%s', (name) => {
  const result = spawnSync('bun', ['run', fileURLToPath(new URL('./backend-persistence.fixture.ts', import.meta.url)), name], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, DATABASE_URL: '禁止连接真实数据库' },
  })
  expect(result.error, result.error?.message).toBeUndefined()
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})

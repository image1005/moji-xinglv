import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { RenameVersionSchema, VersionSchema } from '../shared/schemas/workspace'

it('版本共享契约兼容旧数据并校验单行名称', () => {
  const old = VersionSchema.parse({ id: 1, version: 1, source: 'user', parentVersionId: null, messageId: null, createdAt: '', diffJson: null })
  expect([old.name, old.nameSource, old.nameRevision]).toEqual([null, null, 0])
  expect(RenameVersionSchema.parse({ name: '  西湖晨游  ', expectedNameRevision: 0 }).name).toBe('西湖晨游')
  for (const name of ['', '   ', '<b>名称</b>', '名称\n第二行', '名称\u0000', '旅'.repeat(41)]) {
    expect(RenameVersionSchema.safeParse({ name, expectedNameRevision: 0 }).success, name).toBe(false)
  }
  expect(RenameVersionSchema.safeParse({ name: '旅'.repeat(40), expectedNameRevision: 0 }).success).toBe(true)
})

it.each([
  ['rename', '独立命名与规划 revision 分离，使用展示版本号并检测名称并发冲突'],
  ['scope', '用户与规划归属校验阻止越权，迟到结果不得写入更换归属的版本'],
  ['success', '命名读最终快照和父版本，事务外执行且同版本只请求一次'],
  ['fallback', '模型失败或非法结果保留回退名，重复调度不会重复请求'],
  ['userPriority', '用户名称优先，迟到的 AI 结果不能覆盖人工名称'],
  ['snapshotRace', '版本内容、父节点及父快照改变均拒绝迟到命名'],
  ['http', '真实 H3 路由验证请求、展示版本号、返回契约与 400/404/409'],
  ['model', '正常路径通过现有模型提供方发送 HTTP 命名请求并校验结果'],
])('%s：%s', (name) => {
  const result = spawnSync('bun', ['run', fileURLToPath(new URL('./version-names.fixture.ts', import.meta.url)), name], {
    encoding: 'utf8', timeout: 20000, env: { ...process.env, DATABASE_URL: '禁止连接真实数据库', AI_API_KEY: '' },
  })
  expect(result.error, result.error?.message).toBeUndefined()
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})

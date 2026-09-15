/** 自包含隔离集成验收。只用临时数据库与随机凭据，不触碰用户data/app.db。 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 此脚本只连接回环地址；隔离本进程继承的代理，避免本机验收被代理转发。
for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) process.env[name] = ''
process.env.NO_PROXY = 'localhost,127.0.0.1'
process.env.no_proxy = 'localhost,127.0.0.1'

const dir = await mkdtemp(join(tmpdir(), 'shanhai-check-'))
const password = crypto.randomUUID() + 'Aa9!'
const email = 'integration@example.invalid'
const port = 3219
const origin = `http://127.0.0.1:${port}`
const env = {
  ...process.env,
  DATABASE_URL: `file:${join(dir, 'test.db').replaceAll('\\', '/')}`,
  AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  BETTER_AUTH_URL: origin,
  AI_API_KEY: '',
  BAIDU_MAP_AK: '',
  NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port),
  HOST: '127.0.0.1', PORT: String(port),
  SMOKE_BASE: origin, SMOKE_EMAIL: email, SMOKE_PASSWORD: password,
}
const migrate = Bun.spawn([process.execPath, 'run', 'server/database/migrate.ts'], { env, stdout: 'pipe', stderr: 'pipe' })
assert.equal(await migrate.exited, 0, await new Response(migrate.stderr).text())
const server = Bun.spawn([process.execPath, '.output/server/index.mjs'], { env, stdout: 'inherit', stderr: 'inherit' })
try {
  let ready = false
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(2000) })
      if (response.ok) { ready = true; break }
    } catch { /* 有上限的启动就绪检查 */ }
    await Bun.sleep(250)
  }
  assert(ready, '隔离生产服务未能启动')
  const registered = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email, password, name: '集成测试' }),
  })
  assert(registered.ok, `隔离测试账号创建失败 HTTP ${registered.status}: ${(await registered.text()).slice(0, 1000)}`)
  const smoke = Bun.spawn([process.execPath, 'run', 'scripts/smoke.ts'], { env, stdout: 'inherit', stderr: 'inherit' })
  assert.equal(await smoke.exited, 0, 'HTTP 冒烟失败')
  console.log('[isolated] 生产构建 HTTP 验收通过；未调用真实 AI 或地图，未写入用户数据库。')
} finally {
  server.kill()
  await server.exited
  // 精确删除本脚本独自创建的随机临时目录，不扫描/清理其他个人文件。
  await rm(dir, { recursive: true, force: true })
}

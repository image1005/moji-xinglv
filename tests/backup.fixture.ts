import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { backupDatabase } from '../scripts/db-backup'
import { verifyDatabaseBackup } from '../scripts/db-restore-verify'

const temporaryRoot = realpathSync(tmpdir())
const directory = mkdtempSync(join(temporaryRoot, 'shanhai-backup-test-'))
const source = join(directory, 'source.sqlite')
const output = join(directory, 'backup.sqlite')
const writer = new Database(source)
try {
  writer.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;')
  for (const table of ['user', 'plans', 'plan_versions', 'conversations', 'messages', 'agents_md']) {
    writer.exec(`CREATE TABLE "${table}" (id INTEGER PRIMARY KEY, value TEXT)`)
  }
  writer.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const sourceBefore = readFileSync(source)
  writer.query('INSERT INTO plans (value) VALUES (?)').run('secret fixture data never printed')
  writer.query('INSERT INTO messages (value) VALUES (?)').run('private fixture message never printed')
  assert.ok(existsSync(`${source}-wal`), 'fixture 必须包含尚未 checkpoint 的 WAL')
  const result = backupDatabase(source, output)
  assert.equal(result.backup, output)
  assert.ok(result.bytes > 0)
  assert.deepEqual(readFileSync(source), sourceBefore, '只读备份不得改写主库文件')
  const report = verifyDatabaseBackup(output)
  assert.equal(report.ok, true)
  assert.equal(report.counts.plans, 1, '备份包括已提交的 WAL 数据')
  assert.equal(report.counts.messages, 1)
  writer.exec('BEGIN IMMEDIATE')
  writer.query('INSERT INTO plans (value) VALUES (?)').run('uncommitted')
  const concurrent = backupDatabase(source, join(directory, 'concurrent.sqlite'))
  assert.equal(verifyDatabaseBackup(concurrent.backup).counts.plans, 1, '活动写事务的未提交数据不得进入快照')
  writer.exec('ROLLBACK')
  const beforeOutput = readFileSync(output)
  assert.throws(() => backupDatabase(source, output), /已存在/)
  assert.deepEqual(readFileSync(output), beforeOutput)
  assert.throws(() => backupDatabase(source, source), /源数据库/)
  assert.throws(() => backupDatabase(source, `${source}-wal`), /日志文件/)
  const empty = join(directory, 'existing-empty.sqlite')
  writeFileSync(empty, '')
  assert.throws(() => backupDatabase(source, empty), /已存在/)
  assert.equal(readFileSync(empty).length, 0)
  const bad = join(directory, 'corrupt.sqlite')
  writeFileSync(bad, 'not a database')
  assert.throws(() => verifyDatabaseBackup(bad))
  const failedTarget = join(directory, 'failed.sqlite')
  assert.throws(() => backupDatabase(bad, failedTarget))
  assert.equal(existsSync(failedTarget), false, '失败备份只清理自己创建的新目标')
  console.log(JSON.stringify({ ok: true, cases: ['wal-snapshot', 'uncommitted-isolation', 'source-unchanged', 'restore-counts', 'reject-overwrite', 'reject-source', 'reject-empty-target', 'reject-corrupt'] }))
} finally {
  writer.close()
  const checked = realpathSync(directory)
  const segment = relative(temporaryRoot, checked)
  assert.ok(segment && segment !== '..' && !segment.startsWith(`..${sep}`) && resolve(temporaryRoot, segment) === checked)
  rmSync(checked, { recursive: true })
}

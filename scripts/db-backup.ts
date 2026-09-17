import { Database } from 'bun:sqlite'
import { closeSync, existsSync, mkdirSync, openSync, realpathSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

function samePath(left: string, right: string) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

/**
 * SQLite 管理操作，不导入应用 db.ts，也不写入源数据库。
 * VACUUM INTO 在一致的读取快照上复制数据库，包含已经提交但尚未 checkpoint 的 WAL 数据。
 * 目标先用 wx 独占创建；SQLite 只写这次调用拥有的空文件，拒绝覆盖任何已有文件。
 */
export function backupDatabase(sourceInput: string, outputInput?: string, backupDirectory = process.env.BACKUP_DIR ?? './backups') {
  const source = realpathSync(resolve(sourceInput.replace(/^file:/, '')))
  if (!statSync(source).isFile()) throw new Error('备份源必须是已存在的 SQLite 文件')
  const proposed = resolve(outputInput ?? join(backupDirectory, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.sqlite`))
  mkdirSync(dirname(proposed), { recursive: true })
  const output = join(realpathSync(dirname(proposed)), basename(proposed))
  if ([source, `${source}-wal`, `${source}-shm`, `${source}-journal`].some((path) => samePath(path, output))) {
    throw new Error('备份目标不能是源数据库或其日志文件')
  }
  if (existsSync(output)) throw new Error('备份目标已存在，必须指定新文件')
  const reservation = openSync(output, 'wx', 0o600)
  closeSync(reservation)
  let database: Database | undefined
  try {
    database = new Database(source, { readonly: true, create: false })
    database.query('PRAGMA busy_timeout = 5000').run()
    database.query('VACUUM INTO ?').run(output)
    database.close()
    database = undefined
    return { backup: output, bytes: statSync(output).size }
  } catch {
    database?.close()
    // output 经过绝对路径与源文件边界检查，而且仅由本次 wx 创建。
    unlinkSync(output)
    throw new Error('无法创建 SQLite 一致性备份；源数据库未改动，请检查源文件和目标目录')
  }
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ args: process.argv.slice(2), options: { source: { type: 'string' }, output: { type: 'string' } }, strict: true })
    const result = backupDatabase(values.source ?? process.env.DATABASE_URL ?? 'file:./data/app.db', values.output)
    console.log(JSON.stringify(result))
  } catch {
    console.error('备份失败：请确认源文件存在、目标为新文件且目录可写。未覆盖任何已有文件。')
    process.exitCode = 1
  }
}

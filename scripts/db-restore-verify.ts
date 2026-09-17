import { Database } from 'bun:sqlite'
import { constants, copyFileSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const TABLES = ['user', 'plans', 'plan_versions', 'conversations', 'messages', 'agents_md'] as const

function removeTemporaryCopy(temporaryRoot: string, directory: string) {
  // 只递归清理 mkdtemp 创建的目录，先验证解析后的绝对路径仍在系统临时目录内。
  const checked = realpathSync(directory)
  const withinTemporary = relative(temporaryRoot, checked)
  if (!withinTemporary || withinTemporary === '..' || withinTemporary.startsWith(`..${sep}`) || resolve(temporaryRoot, withinTemporary) !== checked) {
    throw new Error('临时目录边界异常，已停止清理')
  }
  rmSync(checked, { recursive: true })
}

/** 只在新临时副本中演练恢复；不覆盖业务数据库、不输出用户内容。 */
export function verifyDatabaseBackup(backupInput: string) {
  const backup = realpathSync(resolve(backupInput.replace(/^file:/, '')))
  if (!statSync(backup).isFile()) throw new Error('备份必须是文件')
  const temporaryRoot = realpathSync(tmpdir())
  const directory = mkdtempSync(join(temporaryRoot, 'shanhai-restore-'))
  const destination = join(directory, 'restored.sqlite')
  let database: Database | undefined
  try {
    copyFileSync(backup, destination, constants.COPYFILE_EXCL)
    database = new Database(destination, { readonly: true, create: false })
    const integrity = database.query<{ integrity_check: string }, []>('PRAGMA integrity_check').all()
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') throw new Error('恢复副本完整性检查失败')
    if (database.query('PRAGMA foreign_key_check').all().length) throw new Error('恢复副本外键检查失败')
    const tables = new Set(database.query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => row.name))
    if (TABLES.some((name) => !tables.has(name))) throw new Error('备份缺少关键业务表')
    const counts = Object.fromEntries(TABLES.map((table) => [table,
      database!.query<{ count: number }, []>(`SELECT count(*) AS count FROM "${table}"`).get()!.count,
    ])) as Record<typeof TABLES[number], number>
    return { ok: true as const, integrity: 'ok' as const, counts }
  } finally {
    database?.close()
    removeTemporaryCopy(temporaryRoot, directory)
  }
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ args: process.argv.slice(2), options: { backup: { type: 'string' } }, strict: true })
    if (!values.backup) throw new Error('请指定 --backup')
    console.log(JSON.stringify(verifyDatabaseBackup(values.backup)))
  } catch {
    console.error('恢复演练失败：请检查备份格式、关键表和数据完整性。业务数据库未改动。')
    process.exitCode = 1
  }
}

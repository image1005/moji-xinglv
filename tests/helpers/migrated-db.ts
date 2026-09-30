import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from '../../server/database/schema'

const migrationsFolder = fileURLToPath(new URL('../../server/database/migrations', import.meta.url))

/** A disposable connection migrated from the repository SQL, never the configured application database. */
export function createMigratedTestDb(throughIndex?: number) {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  let partialFolder: string | undefined
  try {
    if (throughIndex !== undefined) {
      partialFolder = mkdtempSync(join(tmpdir(), 'xingjian-migrations-'))
      mkdirSync(join(partialFolder, 'meta'))
      const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] }
      journal.entries = journal.entries.filter(entry => entry.idx <= throughIndex)
      for (const entry of journal.entries) cpSync(join(migrationsFolder, `${entry.tag}.sql`), join(partialFolder, `${entry.tag}.sql`))
      writeFileSync(join(partialFolder, 'meta/_journal.json'), JSON.stringify(journal))
    }
    migrate(db, { migrationsFolder: partialFolder ?? migrationsFolder })
    // The legacy service fixtures deliberately use synthetic account/plan IDs.
    sqlite.run('PRAGMA foreign_keys = OFF')
    return { sqlite, db, migrateToLatest: () => migrate(db, { migrationsFolder }) }
  } catch (error) {
    sqlite.close()
    throw error
  } finally {
    if (partialFolder && dirname(resolve(partialFolder)) === resolve(tmpdir()) && basename(partialFolder).startsWith('xingjian-migrations-')) {
      rmSync(partialFolder, { recursive: true, force: true })
    }
  }
}

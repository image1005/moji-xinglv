import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const url = (process.env.DATABASE_URL ?? 'file:/app/data/app.db').replace(/^file:/, '')
const file = resolve(process.cwd(), url)
mkdirSync(dirname(file), { recursive: true })

const sqlite = new Database(file)
sqlite.exec('PRAGMA journal_mode = WAL;')
sqlite.exec('PRAGMA foreign_keys = ON;')
const db = drizzle(sqlite)

try {
  migrate(db, { migrationsFolder: './server/database/migrations' })
  console.log('[db:migrate] production migrations applied successfully')
} catch (err) {
  console.warn('[db:migrate] migration skipped or warning:', err)
}

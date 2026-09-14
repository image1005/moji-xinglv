import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { fileURLToPath } from 'node:url'
import { db } from '../utils/db'

migrate(db, { migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)) })
console.log('[db:migrate] migrations applied')

import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as schema from '../database/schema'

/** 唯一 SQLite 连接与 Drizzle 实例（单一写入者，PRD 裁决 3） */

const url = (process.env.DATABASE_URL ?? 'file:./data/app.db').replace(/^file:/, '')
const file = resolve(process.cwd(), url)
mkdirSync(dirname(file), { recursive: true })

const sqlite = new Database(file)
sqlite.exec('PRAGMA journal_mode = WAL;')
sqlite.exec('PRAGMA foreign_keys = ON;')

export const db = drizzle(sqlite, { schema })

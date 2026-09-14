import { defineConfig } from 'drizzle-kit'

const url = (process.env.DATABASE_URL ?? 'file:./data/app.db').replace(/^file:/, '')

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dbCredentials: { url },
})

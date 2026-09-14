import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import * as schema from '../database/schema'
import { db } from './db'

/** Better Auth 实例：Drizzle adapter + admin 插件（RBAC，PRD 裁决 1） */
export const auth = betterAuth({
  appName: '墨迹行旅',
  secret: process.env.AUTH_SECRET ?? 'dev-only-secret-change-me',
  baseURL: process.env.BETTER_AUTH_URL || undefined,
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  emailAndPassword: { enabled: true, minPasswordLength: 6 },
  plugins: [admin({ defaultRole: 'user' })],
})

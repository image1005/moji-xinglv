import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import * as schema from '../database/schema'
import { db } from './db'
import { readAuthEnv } from './env'

const env = readAuthEnv()

/** Better Auth 实例：Drizzle adapter + admin 插件（RBAC，PRD 裁决 1） */
export const auth = betterAuth({
  appName: '山海行笺',
  secret: env.secret,
  baseURL: env.baseURL,
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  emailAndPassword: { enabled: true, minPasswordLength: 6 },
  plugins: [admin({ defaultRole: 'user' })],
})

import { z } from 'zod'

type Environment = Record<string, string | undefined>
const DEV_AUTH_SECRET = 'dev-only-secret-change-me-before-production'
const httpUrl = z.string().url().refine((value) => /^https?:\/\//i.test(value), '地址必须使用 HTTP 或 HTTPS')

export function readAuthEnv(env: Environment = process.env) {
  const production = env.NODE_ENV === 'production'
  const schema = z.object({
    secret: production
      ? z.string().trim().min(32, '生产环境 AUTH_SECRET 至少需要 32 字符')
        .refine((value) => value !== DEV_AUTH_SECRET, '生产环境不能使用开发密钥')
      : z.string().min(1),
    baseURL: production ? httpUrl : httpUrl.optional(),
  })
  return schema.parse({
    secret: env.AUTH_SECRET || (production ? undefined : DEV_AUTH_SECRET),
    baseURL: env.BETTER_AUTH_URL || undefined,
  })
}

export function readSeedAdminEnv(env: Environment = process.env) {
  const production = env.NODE_ENV === 'production'
  return z.object({
    email: z.email(),
    password: z.string().min(production ? 12 : 6)
      .refine((value) => !production || value !== 'admin123456', '生产环境必须显式配置强管理员密码'),
  }).parse({
    email: env.SEED_ADMIN_EMAIL ?? 'admin@example.com',
    password: env.SEED_ADMIN_PASSWORD ?? (production ? undefined : 'admin123456'),
  })
}

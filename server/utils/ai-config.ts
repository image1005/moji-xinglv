import { z } from 'zod'

const setting = (fallback: number, max: number, min = 1) => z.coerce.number().int().min(min).max(max).default(fallback)
const ConfigSchema = z.object({
  AI_INPUT_MAX_BYTES: setting(96000, 1000000, 32000),
  AI_OUTPUT_MAX_TOKENS: setting(4096, 32000, 256),
  AI_GLOBAL_CONCURRENCY: setting(4, 100),
  AI_USER_CONCURRENCY: setting(1, 10),
  AI_QUEUE_LIMIT: setting(8, 100, 0),
  AI_QUEUE_WAIT_MS: setting(10000, 30000, 0),
  AI_REQUESTS_PER_PERIOD: setting(60, 100000),
  AI_GLOBAL_REQUESTS_PER_PERIOD: setting(1000, 1000000),
  AI_PERIOD_SECONDS: setting(3600, 2592000),
})

export const aiConfig = () => ConfigSchema.parse(process.env)

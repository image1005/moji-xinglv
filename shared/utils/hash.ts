import { stableStringify } from './json'

/**
 * 缓存键：key = hash(api + params)（PRD §3.10）
 * 前后端同构（Web Crypto），稳定序列化保证参数顺序无关。
 */
export async function hashKey(api: string, params: unknown): Promise<string> {
  const data = new TextEncoder().encode(`${api}|${stableStringify(params ?? null)}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

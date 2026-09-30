/**
 * 生成 RFC 4122 v4 UUID。
 *
 * `crypto.randomUUID` 只在安全上下文（HTTPS 或 localhost）暴露。以 HTTP + IP 部署时
 * 浏览器没有该方法，直接调用会抛 `TypeError: crypto.randomUUID is not a function` 并中断
 * 对话等主流程；CI 与本地跑在 localhost，属安全上下文，因此测不出来。
 *
 * 此处退化为同样不要求安全上下文的 `crypto.getRandomValues` 就地构造，保证前后端同构、
 * 输出格式与 `randomUUID` 一致，不引入额外依赖。
 */
export function randomUUID(): string {
  const webCrypto: Crypto | undefined = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()

  const bytes = new Uint8Array(16)
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes)
  } else {
    // 无 Web Crypto 的极端环境仍需可用；此时已不具备密码学随机性。
    for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256)
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

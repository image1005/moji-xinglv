/**
 * 工具错误的可读透传（方案 A）：
 * 只有带数字 statusCode 的「我们自己产生的」HTTP 错误才携带可操作提示；
 * 其余未知错误一律回落到通用文案，避免泄漏上游细节。
 */
const ACTIONABLE_PREFIX = '[actionable]'
const MAX_LENGTH = 400

class ActionableToolError extends Error {}

function sanitizeToolError(text: string): string {
  let clean = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    clean += code < 32 || code === 127 ? ' ' : char
  }
  clean = clean.replace(/\s+/g, ' ').trim()
  return clean.length > MAX_LENGTH ? `${clean.slice(0, MAX_LENGTH)}…` : clean
}

/** 从工具错误中提取可操作文案；非我们产生的错误返回 null。 */
export function actionableMessage(error: unknown): string | null {
  const value = error as { statusCode?: unknown; statusMessage?: unknown } | null
  const status = Number(value?.statusCode)
  if (!Number.isInteger(status) || status < 400 || status >= 600) return null
  const message = typeof value?.statusMessage === 'string' ? value.statusMessage.trim() : ''
  return message ? sanitizeToolError(message) : null
}

export function markActionable(message: string): Error {
  return new ActionableToolError(`${ACTIONABLE_PREFIX} ${sanitizeToolError(message)}`)
}

/** Mastra 会用 Error.cause 包装工具异常；只放行应用标记的错误，拒绝上游伪造相同文本前缀。 */
export function preserveActionableError(error: unknown): string | null {
  let current = error
  const seen = new Set<unknown>()
  for (let depth = 0; depth < 8 && current instanceof Error && !seen.has(current); depth++) {
    if (current instanceof ActionableToolError) return current.message
    seen.add(current)
    current = current.cause
  }
  return null
}

export function extractActionable(errorText: unknown): string | null {
  if (typeof errorText !== 'string') return null
  // The SDK may serialize a MastraError (including cause) instead of a plain message.
  // Extract only its message fields, never append serialized details to the UI error.
  if (errorText.trimStart().startsWith('{')) {
    try {
      const visit = (value: unknown, depth: number): string | null => {
        if (!value || typeof value !== 'object' || depth > 8) return null
        const entry = value as { message?: unknown; cause?: unknown }
        return visit(entry.cause, depth + 1) ?? (typeof entry.message === 'string' ? extractActionable(entry.message) : null)
      }
      return visit(JSON.parse(errorText), 0)
    } catch { return null }
  }
  const index = errorText.indexOf(ACTIONABLE_PREFIX)
  if (index < 0) return null
  const message = sanitizeToolError(errorText.slice(index + ACTIONABLE_PREFIX.length))
  return message || null
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

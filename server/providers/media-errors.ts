import { z } from 'zod'
import type { PlanResource } from '../../shared/schemas/media'

/** Persist actionable categories, never raw upstream bodies, URLs or credentials. */
export function imageFailure(error: unknown): NonNullable<PlanResource['imageIssue']> {
  const value = error as { name?: string; data?: { providerStatus?: number; mediaConfiguration?: boolean } } | null
  if (value?.data?.mediaConfiguration) return { code: 'configuration', message: '图片搜索服务未配置或未授权，请联系管理员检查开通状态和凭据。' }
  if (value?.name === 'TimeoutError' || value?.name === 'AbortError') return { code: 'timeout', message: '图片来源响应超时，请稍后重试。' }
  if (value?.data?.providerStatus === 429) return { code: 'rate_limited', message: '图片来源暂时限流，请稍后再查。' }
  if (error instanceof z.ZodError || error instanceof SyntaxError) return { code: 'invalid_response', message: '图片来源返回格式异常，请稍后重试。' }
  if (error instanceof TypeError) return { code: 'network', message: '无法连接图片来源，请检查服务端网络后重试。' }
  return { code: 'unavailable', message: '图片暂时无法下载或解码，请稍后重试。' }
}

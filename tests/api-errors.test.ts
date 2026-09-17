import { describe, expect, it } from 'vitest'
import { apiErrorMessage } from '../app/utils/api'

describe('普通 API 与 AI 流错误提示', () => {
  it('AI SDK JSON 字符串中的限额与重复请求保留可操作原因', () => {
    expect(apiErrorMessage(new Error(JSON.stringify({ statusCode: 429, statusMessage: '本周期生成额度已用完，请稍后再试' })))).toBe('本周期生成额度已用完，请稍后再试')
    expect(apiErrorMessage(new Error(JSON.stringify({ statusCode: 409, statusMessage: '该请求已处理，请读取已有结果' })))).toBe('该请求已处理，请读取已有结果')
  })
  it('保存冲突明确保留草稿，偏好冲突说明对应对象', () => {
    expect(apiErrorMessage({ statusCode: 409 })).toContain('草稿仍保留')
    expect(apiErrorMessage({ statusCode: 409, data: { statusMessage: '偏好已被更新，请重新读取' } })).toContain('偏好已被更新')
  })
  it('非 JSON 网络错误和空错误仍有提示', () => {
    expect(apiErrorMessage(new Error('网络暂不可用'))).toBe('网络暂不可用')
    expect(apiErrorMessage(null)).toBe('操作失败，请稍后重试')
  })
})

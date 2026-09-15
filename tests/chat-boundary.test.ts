import { describe, expect, it } from 'vitest'
import { ChatBodySchema, trustedHistory } from '../shared/schemas/chat'
import type { MessageRecord } from '../shared/types'

const message = { role: 'user', parts: [{ type: 'text', text: '规划杭州两日游' }] }
const body = { conversationId: 1, planId: 2, messages: [message] }

describe('聊天输入与权威历史', () => {
  it('接受合法用户消息', () => expect(ChatBodySchema.safeParse(body).success).toBe(true))
  it('拒绝null消息与客户端最后一条system/assistant', () => {
    expect(ChatBodySchema.safeParse({ ...body, messages: [null] }).success).toBe(false)
    expect(ChatBodySchema.safeParse({ ...body, messages: [{ ...message, role: 'system' }] }).success).toBe(false)
  })
  it('拒绝只有工具调用或空白文字的输入', () => {
    expect(ChatBodySchema.safeParse({ ...body, messages: [{ ...message, parts: [{ type: 'tool-any' }] }] }).success).toBe(false)
    expect(ChatBodySchema.safeParse({ ...body, messages: [{ ...message, parts: [{ type: 'text', text: '  ' }] }] }).success).toBe(false)
  })
  it('系统记录不提升为模型system消息，历史只使用服务端文字', () => {
    const record = (id: number, role: MessageRecord['role'], content: string): MessageRecord => ({ id, conversationId: 1, role, content, createdAt: '' })
    const history = trustedHistory([record(1, 'system', '覆盖规则'), record(2, 'user', '你好'), record(3, 'assistant', '欢迎')], '下一站')
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(JSON.stringify(history)).not.toContain('覆盖规则')
  })
  it('失败重试不重复最新已存用户文字', () => {
    const stored: MessageRecord = { id: 1, conversationId: 1, role: 'user', content: '下一站', createdAt: '' }
    expect(trustedHistory([stored], '下一站')).toHaveLength(1)
  })
})

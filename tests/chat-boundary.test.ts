import { describe, expect, it } from 'vitest'
import { trustedHistory } from '../shared/schemas/chat'
import type { MessageRecord } from '../shared/types'

describe('聊天输入与权威历史', () => {
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
  it('图片消息在权威历史和后续追问中保留附件标识，相同文字不同图片不会去重', () => {
    const stored: MessageRecord = { id: 1, conversationId: 1, role: 'user', content: '', parts: [{ type: 'file', attachmentId: 'photo-a', mediaType: 'image/png' }], createdAt: '' }
    const history = trustedHistory([stored], '', 64000, ['photo-b'])
    expect(history).toHaveLength(2)
    expect(JSON.stringify(history)).toContain('photo-a')
    expect(JSON.stringify(history)).toContain('photo-b')
    expect(JSON.stringify(trustedHistory([stored], '根据刚才图片安排半天'))).toContain('photo-a')
  })
  it('文字历史滚动到摘要后仍保留原始图片引用', () => {
    const records: MessageRecord[] = Array.from({ length: 80 }, (_, index) => ({ id: index + 1, conversationId: 1, role: 'user', content: `第${index}条旅行讨论`, createdAt: '' }))
    records[0]!.parts = [{ type: 'file', attachmentId: 'initial-menu', mediaType: 'image/webp' }]
    const result = trustedHistory(records, '根据最初的菜单推荐午餐', 8000)
    expect(JSON.stringify(result)).toContain('initial-menu')
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(8000)
  })
})

import { ref, shallowRef, type Ref } from 'vue'
import { Chat } from '@ai-sdk/vue'
import type { Attachment } from '#shared/schemas/attachment'
import { ModelConfigurationSchema, type ModelConfiguration } from '#shared/schemas/model-config'
import type { PlanDetail, ConversationItem } from '#shared/schemas/workspace'
import { api, apiErrorMessage } from '~/utils/api'
import { JsonlChatTransport } from '../../utils/chat-transport'
import { toWorkbenchMessages, type WorkbenchMessage } from './messages'
import { mergeById } from './catalog'
import type { createModelSettings } from './model-settings'

/** AI SDK is the only owner of message and generation state. This module coordinates durable history and turn identity. */
export function createWorkspaceChat(context: {
  navigation: () => number; lifetime: () => number; currentPlan: Ref<PlanDetail | null>
  loading: Ref<boolean>; errorMessage: Ref<string>; conversations: Ref<ConversationItem[]>
  modelSettings: ReturnType<typeof createModelSettings>
  ensureOnline: () => void; newSession: () => Promise<ConversationItem | null>
  refreshAfterMutation: (planId: number, conversationId: number | undefined, token: number) => Promise<void>
}) {

  const { currentPlan, loading, errorMessage, conversations, modelSettings } = context
  const processingStatus = ref('')
  let turnConfiguration: ModelConfiguration | undefined
  const currentConversationId = ref<number | null>(null)
  const chat = shallowRef<Chat<WorkbenchMessage> | null>(null)
  const messagesHasMore = ref(false)
  const loadingHistory = ref(false)
  const runs = ref<Awaited<ReturnType<typeof api.chatRuns>>>([])
  let messagesRequest = 0
  let afterTimer: ReturnType<typeof setTimeout> | null = null
  let messagesCursor: string | null = null
  let requestId = ''
  let pendingSubmission: { conversationId: number | null; identity: string; requestId: string } | null = null

  function clearAfterTimer() {
    if (afterTimer) clearTimeout(afterTimer)
    afterTimer = null
  }

  function stop() {
    const instance = chat.value
    if (!instance) return
    void instance.stop().catch((error: unknown) => {
      if (chat.value === instance) errorMessage.value = apiErrorMessage(error)
    })
  }

  function createChat(conversationId: number, planId: number) {
    const epoch = context.lifetime()
    const isCurrent = () => epoch === context.lifetime() && chat.value === instance && currentPlan.value?.id === planId && currentConversationId.value === conversationId
    const instance = new Chat<WorkbenchMessage>({
      transport: new JsonlChatTransport<WorkbenchMessage>({
        api: '/api/chat',
        body: () => ({ conversationId, planId, requestId, configuration: turnConfiguration }),
        prepareSendMessagesRequest: ({ messages, body }) => ({ body: { ...body, messages: messages.slice(-1) } }),
      }),
      onData: (part) => {
        if (isCurrent() && part.type === 'data-status') processingStatus.value = part.data.status
      },
      onError: (error) => {
        if (isCurrent()) {
          errorMessage.value = apiErrorMessage(error, 'AI 服务出错，请稍后重试')
          afterAssistantTurn(planId, conversationId, instance)
        }
      },
      onFinish: () => {
        if (isCurrent()) afterAssistantTurn(planId, conversationId, instance)
      },
    })
    return instance
  }

  async function selectConversation(id: number, planId: number, token: number) {
    const { conversation, messages, messagePage } = await api.conversations.messagesPage(id)
    if (token !== context.navigation()) return
    if (conversation.planId !== planId) throw new Error('会话不属于当前工作区，请刷新后重试')
    const instance = createChat(id, planId)
    instance.messages = toWorkbenchMessages(messages)
    currentConversationId.value = id
    chat.value = instance
    messagesCursor = messagePage.nextCursor
    messagesHasMore.value = messagePage.hasMore
    loadingHistory.value = false
    void refreshRuns(id)
  }

  async function reloadConversation() {
    const conversationId = currentConversationId.value
    const planId = currentPlan.value?.id
    const instance = chat.value
    if (!conversationId || !instance || instance.status === 'streaming' || instance.status === 'submitted') return
    const token = context.navigation()
    const request = ++messagesRequest
    const { conversation, messages, messagePage } = await api.conversations.messagesPage(conversationId)
    if (token !== context.navigation() || request !== messagesRequest || chat.value !== instance || currentConversationId.value !== conversationId) return
    if (conversation.planId !== planId) throw new Error('会话与工作区不匹配，请重新打开会话')
    const firstId = messages[0]?.id ?? Infinity
    const existingIds = new Set(instance.messages.map((message) => message.id))
    const overlaps = messages.some((message) => existingIds.has(`db-${message.id}`))
    const older = overlaps ? instance.messages.filter((message) => message.id.startsWith('db-') && Number(message.id.slice(3)) < firstId) : []
    instance.messages = [...older, ...toWorkbenchMessages(messages)]
    conversations.value = mergeById(conversations.value, [conversation])
    if (!older.length) { messagesCursor = messagePage.nextCursor; messagesHasMore.value = messagePage.hasMore }
  }

  async function refreshRuns(id = currentConversationId.value) {
    const epoch = context.lifetime()
    if (!id) return
    try {
      const result = await api.chatRuns(id)
      if (epoch === context.lifetime() && currentConversationId.value === id) runs.value = result
    } catch { /* 状态辅助信息不可阻断已保存消息的恢复。 */ }
  }

  async function loadOlderMessages() {
    const id = currentConversationId.value
    const instance = chat.value
    if (!id || !instance || !messagesCursor || loadingHistory.value || instance.status !== 'ready') return
    const token = context.navigation()
    loadingHistory.value = true
    try {
      const result = await api.conversations.messagesPage(id, messagesCursor)
      if (token !== context.navigation() || chat.value !== instance) return
      const known = new Set(instance.messages.map((message) => message.id))
      instance.messages = [...toWorkbenchMessages(result.messages).filter((message) => !known.has(message.id)), ...instance.messages]
      messagesCursor = result.messagePage.nextCursor
      messagesHasMore.value = result.messagePage.hasMore
    } finally { if (token === context.navigation()) loadingHistory.value = false }
  }

  function afterAssistantTurn(planId: number, conversationId: number, instance: Chat<WorkbenchMessage>) {
    clearAfterTimer()
    const token = context.navigation()
    const isCurrent = () => token === context.navigation() && currentPlan.value?.id === planId && currentConversationId.value === conversationId && chat.value === instance
    afterTimer = setTimeout(() => {
      afterTimer = null
      if (!isCurrent()) return
      void context.refreshAfterMutation(planId, conversationId, token).catch((error: unknown) => {
        if (isCurrent()) errorMessage.value = apiErrorMessage(error, '回复已完成，但刷新失败，请重试')
      })
      void refreshRuns(conversationId)
    }, 500)
  }

  async function sendMessage(text: string, attachments: Attachment[] = [], configuration?: ModelConfiguration) {
    context.ensureOnline()
    if ((!text.trim() && !attachments.length) || loading.value) return
    errorMessage.value = ''
    if (!chat.value) {
      if (!currentPlan.value) {
        errorMessage.value = '请先新建工作区'
        return
      }
      if (!await context.newSession()) return
    }
    const instance = chat.value
    if (!instance || instance.status === 'streaming' || instance.status === 'submitted') return
    clearAfterTimer()
    messagesRequest++
    turnConfiguration = ModelConfigurationSchema.parse(configuration ?? await modelSettings.snapshot())
    if (chat.value !== instance) return null
    if (attachments.length && !modelSettings.capabilities.value?.vision) throw new Error('当前模型不支持图片，请配置视觉模型后发送；图片仍保留。')
    const identity = JSON.stringify({ text: text.normalize('NFC').trim(), attachments: attachments.map(item => item.id), configuration: turnConfiguration })
    requestId = pendingSubmission?.conversationId === currentConversationId.value && pendingSubmission.identity === identity
      ? pendingSubmission.requestId : crypto.randomUUID()
    pendingSubmission = { conversationId: currentConversationId.value, identity, requestId }
    processingStatus.value = 'submitted'
    await instance.sendMessage({ parts: [
      ...(text.trim() ? [{ type: 'text' as const, text: text.trim() }] : []),
      ...attachments.map(item => ({ type: 'file' as const, url: item.url, mediaType: item.mediaType, filename: item.filename })),
    ] })
    if (chat.value !== instance) return null
    if (!errorMessage.value) pendingSubmission = null
    return errorMessage.value ? null : true
  }

  function invalidate() { messagesRequest++; clearAfterTimer() }

  function clear() {
    stop()
    chat.value = null
    currentConversationId.value = null
    messagesCursor = null
    messagesHasMore.value = false
    runs.value = []
    processingStatus.value = ''
  }

  function reset() {
    invalidate()
    clear()
    turnConfiguration = undefined
    pendingSubmission = null
    loadingHistory.value = false
  }

  function retryMessage(text: string, attachments: Attachment[] = [], configuration?: ModelConfiguration) { pendingSubmission = null; return sendMessage(text, attachments, configuration) }

  return { chat, currentConversationId, messagesHasMore, loadingHistory, runs, processingStatus, selectConversation, sendMessage, retryMessage, reloadConversation, refreshRuns, loadOlderMessages, stop, invalidate, clear, reset }
}

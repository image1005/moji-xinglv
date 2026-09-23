import { defineEventHandler, setResponseHeader } from 'h3'
import { requireUser } from '../utils/session'
import { readChatRequest } from '../services/chat-jsonl'
import { executeChat } from '../services/chat-application'

export default defineEventHandler(async event => {
  const user = await requireUser(event)
  const body = await readChatRequest(event)
  try { return await executeChat(event, user, body) }
  catch (error) {
    const retryAfter = (error as { data?: { retryAfter?: number } }).data?.retryAfter
    if (retryAfter) setResponseHeader(event, 'Retry-After', retryAfter)
    throw error
  }
})

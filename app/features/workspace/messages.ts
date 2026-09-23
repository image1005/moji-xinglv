import type { UIMessage } from 'ai'
import type { MessageRecord, PlanPreview } from '#shared/types'

export type WorkbenchMessage = UIMessage<unknown, { preview: PlanPreview; status: { status: string } }>
interface StoredToolCall {
  id?: string; name?: string; input?: unknown; output?: { preview?: PlanPreview }; error?: unknown
}

/** Map durable legacy columns and current SDK parts into the SDK's one message collection. */
export function toWorkbenchMessages(records: MessageRecord[]): WorkbenchMessage[] {
  return records.map((record) => {
    const parts: unknown[] = [...(record.parts ?? []).filter(part => ['file', 'source-url', 'data-sources'].includes(part.type))]
    if (record.content) parts.unshift({ type: 'text', text: record.content })
    const calls = Array.isArray(record.toolCalls) ? record.toolCalls as StoredToolCall[] : []
    for (const call of calls) {
      if (!call?.name) continue
      parts.push({ type: `tool-${call.name}`, toolCallId: call.id ?? `db-tool-${record.id}-${parts.length}`,
        state: call.error ? 'output-error' : 'output-available', input: call.input, output: call.output, errorText: call.error })
    }
    const preview = record.preview
    if (preview && !calls.some(call => !call.error && call.output?.preview?.planId === preview.planId && call.output.preview.version === preview.version)) {
      parts.push({ type: 'data-preview', data: preview })
    }
    return { id: `db-${record.id}`, role: record.role === 'tool' ? 'assistant' : record.role, parts } as WorkbenchMessage
  })
}

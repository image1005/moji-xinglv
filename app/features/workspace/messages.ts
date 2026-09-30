import type { UIMessage } from 'ai'
import type { MessageRecord, PlanPreview } from '#shared/types'

export type WorkbenchMessage = UIMessage<unknown, { preview: PlanPreview; status: { status: string } }>
interface StoredToolCall {
  id?: string; name?: string; input?: unknown; output?: { preview?: PlanPreview }; error?: unknown
}

interface PreviewPart { type: string; data?: unknown; state?: string; output?: unknown }

/** Persisted message previews describe the terminal result; tool outputs are checkpoints. */
export function messagePreview(parts: readonly PreviewPart[]): PlanPreview | null {
  const authoritative = parts.findLast(part => part.type === 'data-preview' && part.data)
  if (authoritative) return authoritative.data as PlanPreview
  const latest = parts.findLast(part => part.type.startsWith('tool-') && part.state === 'output-available'
    && (part.output as { preview?: PlanPreview } | undefined)?.preview)
  return (latest?.output as { preview?: PlanPreview } | undefined)?.preview ?? null
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
    if (preview) {
      parts.push({ type: 'data-preview', data: preview })
    }
    return { id: `db-${record.id}`, role: record.role === 'tool' ? 'assistant' : record.role, parts } as WorkbenchMessage
  })
}

import { createError } from 'h3'
import { z } from 'zod'
import type { Page, PageOptions } from '../../shared/types'
import { PageOptionsSchema } from '../../shared/schemas/workspace'

export const PageQuerySchema = PageOptionsSchema.extend({
  paged: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

const CursorSchema = z.object({ scope: z.string(), sort: z.number().int().min(0).max(8640000000000000), id: z.number().int().positive() })
type Cursor = z.infer<typeof CursorSchema>

export function readPage(options: PageOptions, scope: string) {
  const limit = PageOptionsSchema.parse(options).limit ?? 50
  let cursor: Cursor | undefined
  if (options.cursor) {
    try {
      cursor = CursorSchema.parse(JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')))
      if (cursor.scope !== scope) throw new Error('scope')
    } catch { throw createError({ statusCode: 400, statusMessage: '分页游标无效，请重新加载列表' }) }
  }
  return { limit, cursor, scope }
}

export function finishPage<T>(rows: T[], page: ReturnType<typeof readPage>, position: (row: T) => { sort: number; id: number }): Page<T> {
  const hasMore = rows.length > page.limit
  const items = rows.slice(0, page.limit)
  const last = items.at(-1)
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ scope: page.scope, ...position(last) })).toString('base64url') : null,
  }
}

import { createError } from 'h3'
import { z } from 'zod'
import { SearchSourceSchema, type SearchSource } from '../../shared/schemas/model-config'
import { providerJson } from './http'

const ResultsSchema = z.object({ results: z.array(z.object({ title: z.string(), url: z.url(), content: z.string() })).max(20) })
export async function searchWeb(query: string, signal?: AbortSignal): Promise<SearchSource[]> {
  if (!process.env.TAVILY_API_KEY) throw createError({ statusCode: 503, statusMessage: '未配置 Tavily 搜索服务' })
  const payload = await providerJson('https://api.tavily.com/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TAVILY_API_KEY}` }, signal,
    body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, include_answer: false, include_raw_content: false, include_images: false }),
  })
  const fetchedAt = new Date().toISOString()
  return ResultsSchema.parse(payload).results.filter(result => /^https?:\/\//.test(result.url)).slice(0, 5).map(result => SearchSourceSchema.parse({ title: result.title.slice(0, 300), url: result.url, summary: result.content.slice(0, 1200), fetchedAt, provider: 'Tavily' }))
}

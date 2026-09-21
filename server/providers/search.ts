import { createError } from 'h3'
import { z } from 'zod'
import { SearchSourceSchema, type SearchSource } from '../../shared/schemas/model-config'
import { providerJson } from './http'

const ResultsSchema = z.object({ results: z.array(z.object({ title: z.string(), url: z.url(), content: z.string() })).max(20) })
type SearchProvider = SearchSource['provider']
/** Only send the existing model key to DeepSeek when it belongs to the official endpoint. */
function officialSearchAvailable() {
  try { return Boolean(process.env.AI_API_KEY?.trim()) && new URL(process.env.AI_BASE_URL || 'https://api.deepseek.com').origin === 'https://api.deepseek.com' && (!process.env.AI_PROVIDER || process.env.AI_PROVIDER === 'deepseek') } catch { return false }
}
export function configuredSearchProvider(): SearchProvider | null {
  const mode = process.env.AI_SEARCH_PROVIDER || 'auto'
  if (mode === 'off') return null
  if ((mode === 'auto' || mode === 'tavily') && process.env.TAVILY_API_KEY?.trim()) return 'Tavily'
  if ((mode === 'auto' || mode === 'deepseek') && officialSearchAvailable()) return 'DeepSeek'
  return null
}
const NativeResultSchema = z.object({ type: z.literal('web_search_result'), title: z.string(), url: z.url(), snippet: z.string().optional() })
const NativeResponseSchema = z.object({ content: z.array(z.object({ type: z.string(), content: z.unknown().optional(), citations: z.array(z.object({ url: z.string().optional(), cited_text: z.string().optional() })).optional() })).max(100) })
async function searchDeepSeek(query: string, signal?: AbortSignal): Promise<SearchSource[]> {
  const payload = await providerJson('https://api.deepseek.com/anthropic/v1/messages', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.AI_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'deepseek-flash', max_tokens: 384, thinking: { type: 'disabled' },
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
      messages: [{ role: 'user', content: `请联网搜索以下旅行资料，提供简短摘要和来源引用：${query}` }],
    }),
  })
  const blocks = NativeResponseSchema.parse(payload).content
  const citations = new Map(blocks.flatMap(block => block.citations ?? []).filter(citation => citation.url && citation.cited_text).map(citation => [citation.url!, citation.cited_text!]))
  const sources = blocks.filter(block => block.type === 'web_search_tool_result' && Array.isArray(block.content)).flatMap(block => block.content as unknown[])
    .flatMap(value => { const result = NativeResultSchema.safeParse(value); return result.success && /^https?:\/\//.test(result.data.url) ? [result.data] : [] })
  const fetchedAt = new Date().toISOString()
  // Never use URLs from assistant prose as evidence, or expose encrypted_content as a summary.
  const result = [...new Map(sources.map(source => [source.url, source])).values()].slice(0, 5).map(source => SearchSourceSchema.parse({
    title: source.title.slice(0, 300), url: source.url, summary: (source.snippet ?? citations.get(source.url) ?? '').slice(0, 1200), fetchedAt, provider: 'DeepSeek',
  }))
  if (!result.length) throw createError({ statusCode: 502, statusMessage: 'DeepSeek 搜索未返回可验证来源，请稍后重试或配置 Tavily 搜索' })
  return result
}
export async function searchWeb(query: string, signal?: AbortSignal, selected = configuredSearchProvider()): Promise<SearchSource[]> {
  signal?.throwIfAborted()
  if (!selected) throw createError({ statusCode: 503, statusMessage: '联网搜索未配置：需要官方 DeepSeek 密钥或 TAVILY_API_KEY' })
  if (selected === 'DeepSeek') {
    if (!officialSearchAvailable()) throw createError({ statusCode: 503, statusMessage: '本轮 DeepSeek 官方搜索配置已失效，请刷新设置' })
    return searchDeepSeek(query, signal)
  }
  if (!process.env.TAVILY_API_KEY?.trim()) throw createError({ statusCode: 503, statusMessage: '本轮 Tavily 搜索配置已失效，请刷新设置' })
  const payload = await providerJson('https://api.tavily.com/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TAVILY_API_KEY}` }, signal,
    body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, include_answer: false, include_raw_content: false, include_images: false }),
  })
  const fetchedAt = new Date().toISOString()
  return ResultsSchema.parse(payload).results.filter(result => /^https?:\/\//.test(result.url)).slice(0, 5).map(result => SearchSourceSchema.parse({ title: result.title.slice(0, 300), url: result.url, summary: result.content.slice(0, 1200), fetchedAt, provider: 'Tavily' }))
}

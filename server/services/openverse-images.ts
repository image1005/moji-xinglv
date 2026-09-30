import { z } from 'zod'
import { createError } from 'h3'
import type { PlanEntity } from '../../shared/utils/plan-entities'
import { hashKey } from '../../shared/utils/hash'
import { mediaIdentity, mediaNameKey, mentionsMediaSubject } from '../providers/media-identity'
import { readProviderBytes } from '../providers/http'
import { getCachedJson, setCachedJson } from './cache'
import { getResourceImageBytes, trustedImageOrigin, type AcquiredImage } from './media-image'

const nullableText = z.string().max(12_000).nullish()
const CandidateSchema = z.object({
  id: z.uuid(), title: nullableText, description: nullableText,
  tags: z.array(z.object({ name: z.string().max(300) })).max(100).nullish(),
  thumbnail: z.string().max(2000).nullish(), url: z.string().max(2000).nullish(), foreign_landing_url: z.string().max(2000).nullish(),
  creator: nullableText, license: z.string().max(100), license_version: z.string().max(100).nullish(),
  license_url: z.string().max(2000).nullish(), source: z.string().max(100).nullish(), category: z.string().max(100).nullish(),
})
const SearchSchema = z.object({ results: z.array(CandidateSchema).max(20) })
const BudgetSchema = z.object({
  hourStartedAt: z.number().finite().nonnegative(), hourUsed: z.number().int().nonnegative(),
  dayStartedAt: z.number().finite().nonnegative(), dayUsed: z.number().int().nonnegative(),
  blockedUntil: z.number().finite().nonnegative(),
})
type Budget = z.infer<typeof BudgetSchema>
type Candidate = z.infer<typeof CandidateSchema>
const budgetKey = 'openverse-anonymous-budget-v1'
const missing = { missing: true } as const
const text = (value: string | null | undefined) => (value ?? '').replace(/<[^>]*>/g, '').replace(/&[a-z0-9#]+;/gi, ' ').trim()
const excluded = /票据|票據|菜单|菜單|招牌|示意图|示意圖|地图|地圖|AI生成|AI绘画|医疗|醫療|直肠|直腸|水彩|油画|油畫|绘画|繪畫|插画|插畫|素描|receipt|menu|diagram|logo|map of|signage|painting|drawing|illustration/i
const foodEvidence = /食品|食物|小吃|菜肴|菜餚|菜品|美食|料理|甜品|甜点|甜點|菜式|饮品|飲品|肉|鸡|雞|鸭|鴨|鱼|魚|羹|面|麵|饺|餃|饭|飯|饼|餅|粥|food|cuisine|dish|dessert|noodles|dumplings/i
const dishTypes = [/面|麵|noodles/i, /饺|餃|dumplings/i, /米线|米線/i, /炒饭|炒飯|fried rice/i, /粥|congee/i]
const comparison = /不同|区别|區別|相比|相较|相較|对比|對比|类似|類似|距离|距離|公里|并非|並非|不是|而非|\b(?:nearby|near|unlike|compared|km|miles?|not)\b|rather than/i
const headers = { 'User-Agent': 'ShanhaiXingjian/1.0 (travel planner; Openverse attribution retained)', Accept: 'application/json' }
let budgetQueue: Promise<unknown> = Promise.resolve()

function rateLimited(until: number) {
  return createError({ statusCode: 429, message: 'Openverse anonymous search limit reached', data: { providerStatus: 429, retryAfter: Math.max(1, Math.ceil((until - Date.now()) / 1000)) } })
}

/** Serialize the single-instance budget and persist it so restarting does not reset the quota. */
function updateBudget<T>(change: (budget: Budget) => Promise<T>) {
  const operation = async () => {
    const now = Date.now()
    const stored = BudgetSchema.safeParse(await getCachedJson<unknown>(budgetKey))
    const budget: Budget = stored.success ? stored.data : { hourStartedAt: now, hourUsed: 0, dayStartedAt: now, dayUsed: 0, blockedUntil: 0 }
    if (now - budget.hourStartedAt >= 3600_000) { budget.hourStartedAt = now; budget.hourUsed = 0 }
    if (now - budget.dayStartedAt >= 86400_000) { budget.dayStartedAt = now; budget.dayUsed = 0 }
    return change(budget)
  }
  const next = budgetQueue.then(operation, operation)
  budgetQueue = next.catch(() => {})
  return next
}

async function reserveSearch(signal: AbortSignal) {
  return updateBudget(async budget => {
    signal.throwIfAborted()
    const until = Math.max(budget.blockedUntil, budget.hourUsed >= 5 ? budget.hourStartedAt + 3600_000 : 0, budget.dayUsed >= 100 ? budget.dayStartedAt + 86400_000 : 0)
    if (until > Date.now()) throw rateLimited(until)
    budget.hourUsed++; budget.dayUsed++
    await setCachedJson(budgetKey, budget, Math.max(86400, Math.ceil((budget.blockedUntil - Date.now()) / 1000)))
  })
}

async function backOff(response: Response) {
  const value = response.headers.get('retry-after')?.trim()
  const seconds = value && /^\d+$/.test(value) ? Number(value) : NaN
  const date = value ? Date.parse(value) : NaN
  const until = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Number.isFinite(date) ? date : Date.now() + 3600_000
  return updateBudget(async budget => {
    budget.blockedUntil = Math.max(budget.blockedUntil, Date.now() + 1000, until)
    await setCachedJson(budgetKey, budget, Math.max(86400, Math.ceil((budget.blockedUntil - Date.now()) / 1000)))
    return rateLimited(budget.blockedUntil)
  })
}

function publicPage(value: string | null | undefined) {
  try {
    const url = new URL(value ?? '')
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

function candidateMatch(candidate: Candidate, entity: PlanEntity) {
  if (candidate.category && candidate.category !== 'photograph') return null
  const identity = mediaIdentity(entity)
  const title = text(candidate.title)
  const tags = (candidate.tags ?? []).map(tag => text(tag.name))
  const description = text(candidate.description)
  const evidence = [title, ...tags, description].join(' ')
  if (excluded.test(evidence)) return null
  const subject = identity.names.find(name => [title, ...tags, description].some(value => mentionsMediaSubject(value, name)))
  if (!subject) return null
  if (entity.entityType === 'food') {
    if (!foodEvidence.test(evidence) || dishTypes.some(pattern => pattern.test(title) && !pattern.test(subject))) return null
    // A food illustration can show the dish in another city, never a different dish with a similar name.
    if (title && !mentionsMediaSubject(title, subject) && /肉|鸡|雞|鸭|鴨|鱼|魚|面|麵|饺|餃|饭|飯|粥|food|dish/i.test(title)) return null
  } else {
    if (!identity.city) return null
    const locationIn = (value: string) => !comparison.test(value) && mediaNameKey(value).includes(mediaNameKey(identity.city)) && mediaNameKey(value).includes(mediaNameKey(subject))
    // Tags can name related places. Require both the subject and city together in the title,
    // or a description that explicitly locates that subject; comparisons are not location evidence.
    const locatedDescription = /位于|位於|坐落|地处|地處|所在地|located (?:in|at)|situated (?:in|at)/i.test(description) && locationIn(description)
    if (!locationIn(title) && !locatedDescription) return null
  }
  return subject
}

/** A failed Openverse proxy may fall back only to an independently verified, fixed provider CDN. */
function controlledOriginal(candidate: Candidate, sourceUrl: string) {
  try {
    const url = new URL(candidate.url ?? '')
    if (candidate.source === 'wikimedia' && ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname)) {
      // Openverse retains Commons attribution tracking parameters; they are not image identity.
      for (const key of [...url.searchParams.keys()]) if (/^utm_(?:source|medium|campaign|term|content)$/.test(key)) url.searchParams.delete(key)
    }
    if (!trustedImageOrigin(url.href) || url.search || url.hash) return null
    if (candidate.source === 'wikimedia' && ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname)) return url.href
    const source = new URL(sourceUrl)
    const photoId = /^\/photos\/[^/]+\/(\d+)\/?$/.exec(source.pathname)?.[1]
    const cdnId = /^\/\d+\/(\d+)_[a-f0-9]{10}(?:_[a-z])?\.jpg$/.exec(url.pathname)?.[1]
    return candidate.source === 'flickr' && ['www.flickr.com', 'flickr.com'].includes(source.hostname) && url.hostname === 'live.staticflickr.com' && photoId && cdnId === photoId ? url.href : null
  } catch { return null }
}

async function search(query: string, retryMissing: boolean, signal: AbortSignal) {
  const cacheId = await hashKey('openverse-query-v1', { q: query, pageSize: 20 })
  const cached = SearchSchema.safeParse(await getCachedJson<unknown>(cacheId))
  if (cached.success && (cached.data.results.length || !retryMissing)) return cached.data
  await reserveSearch(signal)
  const url = new URL('https://api.openverse.org/v1/images/')
  url.search = new URLSearchParams({ q: query, page_size: '20' }).toString()
  const response = await fetch(url, { headers, signal, redirect: 'error' })
  if (response.status === 429) { await response.body?.cancel(); throw await backOff(response) }
  const payload = SearchSchema.parse(JSON.parse((await readProviderBytes(response, 400_000)).toString('utf8')))
  signal.throwIfAborted()
  // Keep valid candidates even when their image host is temporarily unavailable.
  await setCachedJson(cacheId, payload, payload.results.length ? 86400 : 600)
  return payload
}

async function resolve(entity: PlanEntity, retryMissing: boolean, signal: AbortSignal): Promise<AcquiredImage | null> {
  signal.throwIfAborted()
  const identity = mediaIdentity(entity)
  const cacheId = await hashKey('openverse-selection-v1', { ...identity, type: entity.entityType, address: entity.address })
  const cached = await getCachedJson<AcquiredImage | typeof missing>(cacheId)
  if (cached && 'missing' in cached && !retryMissing) return null
  let failed: unknown
  if (cached && !('missing' in cached)) {
    try { await getResourceImageBytes(cached.originUrl, cached.cacheKey, signal); return cached } catch (error) { failed = error }
  }
  signal.throwIfAborted()
  if (!identity.primary || entity.entityType !== 'food' && !identity.city) return null
  // Food illustrations describe the dish, so a city filter would hide valid photos taken elsewhere.
  const query = (entity.entityType === 'food' ? identity.primary : [...new Set([identity.city, identity.primary].filter(Boolean))].join(' ')).slice(0, 240)
  const payload = await search(query, retryMissing, signal)
  let attempts = 0
  for (const candidate of payload.results) {
    signal.throwIfAborted()
    const subject = candidateMatch(candidate, entity)
    const sourceUrl = publicPage(candidate.foreign_landing_url)
    const licenseUrl = publicPage(candidate.license_url)
    const creator = text(candidate.creator)
    const license = text(candidate.license)
    if (!subject || !sourceUrl || !licenseUrl || !license || !creator && !['cc0', 'pdm'].includes(license.toLowerCase())) continue
    const thumbnailUrl = `https://api.openverse.org/v1/images/${candidate.id}/thumb/`
    if (candidate.thumbnail && candidate.thumbnail !== thumbnailUrl) continue
    const original = controlledOriginal(candidate, sourceUrl)
    for (const originUrl of original ? [thumbnailUrl, original] : [thumbnailUrl]) {
      if (attempts >= 3) break
      attempts++
      const cacheKey = await hashKey('openverse-image-v1', { url: originUrl })
      try {
        await getResourceImageBytes(originUrl, cacheKey, signal)
        const acquired: AcquiredImage = { originUrl, cacheKey, image: { url: '', provider: 'Openverse', sourceUrl,
          attribution: `${creator || '作者未注明'} · ${license.toUpperCase()}${candidate.license_version ? ` ${text(candidate.license_version)}` : ''}`.slice(0, 1000),
          kind: entity.entityType === 'food' ? 'food_illustration' : 'place_photo', matchedName: subject.slice(0, 200) } }
        await setCachedJson(cacheId, acquired, 86400)
        return acquired
      } catch (error) { failed = error }
    }
    if (attempts >= 3) break
  }
  signal.throwIfAborted()
  if (failed) throw failed
  await setCachedJson(cacheId, missing, 600)
  return null
}

interface Pending { promise: Promise<AcquiredImage | null>; controller: AbortController; subscribers: number }
const resolving = new Map<string, Pending>()

/** Anonymous, bounded search; every caller can cancel without interrupting other consumers. */
export async function acquireOpenverseImage(entity: PlanEntity, retryMissing = false, signal?: AbortSignal): Promise<AcquiredImage | null> {
  signal?.throwIfAborted()
  const key = await hashKey('openverse-flight-v1', { name: entity.name, city: entity.city, type: entity.entityType, address: entity.address, retryMissing })
  signal?.throwIfAborted()
  let pending = resolving.get(key)
  if (!pending) {
    const controller = new AbortController()
    const promise = resolve(entity, retryMissing, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)])).finally(() => resolving.delete(key))
    pending = { promise, controller, subscribers: 0 }
    resolving.set(key, pending)
  }
  const shared = pending
  shared.subscribers++
  return new Promise((done, reject) => {
    let settled = false
    const release = () => { if (settled) return false; settled = true; shared.subscribers--; signal?.removeEventListener('abort', abort); return true }
    const abort = () => { if (release()) { if (!shared.subscribers) shared.controller.abort(signal?.reason); reject(signal?.reason) } }
    signal?.addEventListener('abort', abort, { once: true })
    shared.promise.then(value => { if (release()) done(value) }, error => { if (release()) reject(error) })
    if (signal?.aborted) abort()
  })
}

import { eq } from 'drizzle-orm'
import { hashKey } from '../../shared/utils/hash'
import { panoramas } from '../database/schema'
import { db } from '../utils/db'
import { getCachedBinary, getCachedJson, setCachedBinary, setCachedJson } from './cache'

/**
 * 唯一的百度服务端代理（硬约束 1）：只有本文件允许读取 BAIDU_MAP_AK。
 * 只代理 staticimage/v2（markers/paths 路线）与 panorama/v2；禁止浏览器端 AK。
 */

const BAIDU_BASE = 'https://api.map.baidu.com'

function ak(): string {
  const value = process.env.BAIDU_MAP_AK
  if (!value) {
    throw createError({ statusCode: 501, statusMessage: '服务端未配置 BAIDU_MAP_AK' })
  }
  return value
}

export interface PanoramaQuery {
  location: string
  width: number
  height: number
  heading?: number
  pitch?: number
  fov?: number
}

export async function getPanoramaImage(
  query: PanoramaQuery,
): Promise<{ buffer: Buffer; contentType: string; cached: boolean }> {
  const hash = await hashKey('panorama/v2', query)
  const existing = await db.select().from(panoramas).where(eq(panoramas.hash, hash)).get()
  if (existing) {
    return { buffer: Buffer.from(existing.imageBlob), contentType: 'image/jpeg', cached: true }
  }

  const url = new URL(`${BAIDU_BASE}/panorama/v2`)
  url.searchParams.set('ak', ak())
  url.searchParams.set('location', query.location)
  url.searchParams.set('width', String(query.width))
  url.searchParams.set('height', String(query.height))
  if (query.heading !== undefined) url.searchParams.set('heading', String(query.heading))
  if (query.pitch !== undefined) url.searchParams.set('pitch', String(query.pitch))
  if (query.fov !== undefined) url.searchParams.set('fov', String(query.fov))

  const res = await fetch(url)
  const contentType = res.headers.get('content-type') ?? ''
  if (!res.ok || !contentType.startsWith('image/')) {
    const detail = await res.text().catch(() => '')
    throw createError({ statusCode: 502, statusMessage: `百度全景获取失败: ${detail.slice(0, 120)}` })
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  await db
    .insert(panoramas)
    .values({
      location: query.location,
      width: query.width,
      height: query.height,
      imageBlob: buffer,
      hash,
    })
    .onConflictDoNothing()
  return { buffer, contentType, cached: false }
}

export interface StaticMapQuery {
  center?: string
  zoom?: number
  width?: number
  height?: number
  scale?: number
  markers?: string[]
  paths?: string[]
  pathStyles?: string
}

const STATIC_MAP_TTL = 60 * 60 * 24 * 7

export async function getStaticMapImage(
  query: StaticMapQuery,
): Promise<{ buffer: Buffer; contentType: string; cached: boolean }> {
  const hash = await hashKey('staticimage/v2', query)
  const cached = await getCachedBinary(hash)
  if (cached) return { buffer: cached, contentType: 'image/png', cached: true }

  const url = new URL(`${BAIDU_BASE}/staticimage/v2`)
  url.searchParams.set('ak', ak())
  url.searchParams.set('width', String(query.width ?? 640))
  url.searchParams.set('height', String(query.height ?? 360))
  if (query.center) url.searchParams.set('center', query.center)
  if (query.zoom !== undefined) url.searchParams.set('zoom', String(query.zoom))
  if (query.scale !== undefined) url.searchParams.set('scale', String(query.scale))
  if (query.markers?.length) url.searchParams.set('markers', query.markers.join('|'))
  if (query.paths?.length) url.searchParams.set('paths', query.paths.join('|'))
  if (query.pathStyles) url.searchParams.set('pathStyles', query.pathStyles)

  const res = await fetch(url)
  const contentType = res.headers.get('content-type') ?? ''
  if (!res.ok || !contentType.startsWith('image/')) {
    const detail = await res.text().catch(() => '')
    throw createError({ statusCode: 502, statusMessage: `百度静态图获取失败: ${detail.slice(0, 120)}` })
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  await setCachedBinary(hash, buffer, STATIC_MAP_TTL)
  return { buffer, contentType: 'image/png', cached: false }
}

export interface PoiResult {
  name: string
  address: string
  lng: number
  lat: number
}

export async function searchPoi(query: string, region: string, pageSize = 5): Promise<PoiResult[]> {
  const hash = await hashKey('place/v2/search', { query, region, pageSize })
  const cached = await getCachedJson<PoiResult[]>(hash)
  if (cached) return cached

  const url = new URL(`${BAIDU_BASE}/place/v2/search`)
  url.searchParams.set('ak', ak())
  url.searchParams.set('output', 'json')
  url.searchParams.set('query', query)
  url.searchParams.set('region', region)
  url.searchParams.set('page_size', String(Math.min(pageSize, 20)))

  const res = await fetch(url)
  if (!res.ok) throw createError({ statusCode: 502, statusMessage: `百度 POI 检索失败: ${res.status}` })
  const data = (await res.json()) as {
    status: number
    message?: string
    results?: { name: string; address?: string; location?: { lng: number; lat: number } }[]
  }
  if (data.status !== 0) {
    throw createError({ statusCode: 502, statusMessage: `百度 POI 检索失败: ${data.message ?? data.status}` })
  }
  const results: PoiResult[] = (data.results ?? [])
    .filter((r) => r.location)
    .map((r) => ({ name: r.name, address: r.address ?? '', lng: r.location!.lng, lat: r.location!.lat }))

  await setCachedJson(hash, results, 60 * 60 * 24)
  return results
}

/// <reference types="@baidumap/jsapi-v4-types" />

let currentKey = ''
let pending: Promise<typeof BMap> | null = null

/** Only accepts the public browser AK. The server AK stays in the image/location proxy. */
export function loadBaiduMap(browserAk: string): Promise<typeof BMap> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('交互地图将在浏览器中加载。'))
  }
  const ak = browserAk.trim()
  if (!ak) return Promise.reject(new Error('交互地图尚未配置浏览器端 AK。'))
  if (pending) {
    if (currentKey !== ak) return Promise.reject(new Error('地图配置已变更，请刷新页面后重试。'))
    return pending
  }

  currentKey = ak
  pending = import('@baidumap/jsapi-loader').then(async ({ default: loader }) => {
    const sdk: unknown = await loader.load({
      ak,
      version: '4.0',
      protocol: 'https',
      timeout: 12_000,
      // JSAPI uses this constant identifier; bd09ll belongs to the Web API.
      globalConfig: { coordType: 'BMAP_COORD_BD09' },
    })
    if (!sdk || typeof sdk !== 'object'
      || !('Map' in sdk) || typeof sdk.Map !== 'function'
      || !('Point' in sdk) || typeof sdk.Point !== 'function'
      || !('Polyline' in sdk) || typeof sdk.Polyline !== 'function') {
      // A callback without a usable SDK must not become a permanently cached success.
      loader.reset()
      throw new Error('地图组件未能加载。')
    }
    return sdk as typeof BMap
  }).catch(() => {
    pending = null
    currentKey = ''
    // The upstream loader includes the full AK-bearing URL in script errors.
    throw new Error('交互地图加载失败，请检查网络、浏览器端 AK 和域名白名单后重试。')
  })
  return pending
}

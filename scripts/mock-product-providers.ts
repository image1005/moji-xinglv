import sharp from 'sharp'

/** Explicit fixture content. Never used by production code or as proof of real provider quality. */
export function createProductProviderFetch(originalFetch: typeof fetch): typeof fetch {
  const fixtureImage = sharp({ create: { width: 240, height: 160, channels: 3, background: '#587064' } }).png().toBuffer()
  const json = (value: unknown) => Response.json(value)
  const implementation = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (/^data:image\/(?:png|jpeg|webp);base64,/.test(url.href)) return originalFetch(input, init)
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return originalFetch(input, init)
    if (url.hostname === 'api.tavily.com' && url.pathname === '/search') return json({ results: [{ title: '[本地测试] 旅行资料', url: 'https://example.org/fixture-travel', content: '这是隔离测试来源，用于验证搜索引用协议，不代表真实营业或门票信息。' }] })
    if (url.hostname === 'zh.wikipedia.org') {
      const title = url.searchParams.get('titles') || '西湖'
      return json({ query: { pages: { '1': { title, extract: `${title}位于杭州。这是本地景点和美食媒体集成测试资料。`, pageimage: 'Shanhai-fixture.png', pageprops: {} } } } })
    }
    if (url.hostname === 'commons.wikimedia.org') return json({ query: { pages: { '2': { imageinfo: [{ url: 'https://upload.wikimedia.org/test-fixture.png', thumburl: 'https://upload.wikimedia.org/test-fixture.png', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Shanhai-fixture.png', extmetadata: { Artist: { value: '[本地测试图] 山海行笺' }, LicenseShortName: { value: '测试夹具，不是实景' } } }] } } } })
    if (url.hostname === 'upload.wikimedia.org') return new Response(new Uint8Array(await fixtureImage), { headers: { 'content-type': 'image/png' } })
    if (url.hostname === 'api.map.baidu.com') {
      if (url.pathname.includes('staticimage') || url.pathname.includes('panorama')) return new Response(new Uint8Array(await fixtureImage), { headers: { 'content-type': 'image/png' } })
      if (url.pathname.includes('geocoding')) return json({ status: 0, result: { location: { lng: 120.15, lat: 30.25 }, level: '城市' } })
      if (url.pathname.includes('place')) {
        const name = url.searchParams.get('query') || ''
        const bridge = name.includes('断桥')
        return json({ status: 0, results: [{ name, city: url.searchParams.get('region'), address: bridge ? '杭州市西湖区北山街' : '杭州市西湖区', uid: 'fixture-only', location: { lng: bridge ? 120.151 : 120.148, lat: bridge ? 30.257 : 30.245 } }] })
      }
    }
    throw new Error(`Product integration forbids external network: ${url.hostname}`)
  }
  return Object.assign(implementation, { preconnect: originalFetch.preconnect }) as typeof fetch
}

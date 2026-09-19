import { createProductProviderFetch } from './mock-product-providers'

if (process.env.PRODUCT_MOCK_PROVIDERS !== '1') throw new Error('Preload requires PRODUCT_MOCK_PROVIDERS=1')
if (!process.env.DATABASE_URL?.includes('test-') && !process.env.DATABASE_URL?.includes('verify-')) throw new Error('Fixtures require an explicitly named isolated test-/verify- database')
if (process.env.AI_API_KEY !== 'fixture-only' || process.env.TAVILY_API_KEY !== 'fixture-only' || process.env.BAIDU_MAP_AK !== 'fixture-only') throw new Error('Fixtures require dummy keys, never real credentials')
globalThis.fetch = createProductProviderFetch(globalThis.fetch)

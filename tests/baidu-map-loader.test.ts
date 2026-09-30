import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Script = { src: string; onerror?: () => void }
let scripts: Script[]
let browser: Record<string, unknown>
const sdk = () => ({ Map: vi.fn(), Point: vi.fn(), Polyline: vi.fn() })

async function loadModule() {
  return import('../app/utils/baidu-map')
}
function complete(script: Script, namespace: unknown = sdk()) {
  browser.BMap = namespace
  const callback = new URL(script.src).searchParams.get('callback')!
  ;(browser[callback] as () => void)()
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  scripts = []
  browser = {}
  vi.stubGlobal('window', browser)
  vi.stubGlobal('document', {
    createElement: () => ({ src: '' }),
    body: { appendChild: (script: Script) => scripts.push(script) },
  })
  const { reset } = await import('@baidumap/jsapi-loader')
  reset()
})

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('浏览器地图按需加载', () => {
  it('SSR 导入安全，缺少浏览器配置时不发起脚本请求', async () => {
    const { loadBaiduMap } = await loadModule()
    await expect(loadBaiduMap(' ')).rejects.toThrow('尚未配置浏览器端 AK')
    vi.stubGlobal('window', undefined)
    await expect(loadBaiduMap('public-test-ak')).rejects.toThrow('将在浏览器中加载')
    expect(scripts).toHaveLength(0)
  })

  it('并发与后续调用共享一个 4.0 SDK，使用百度坐标并阻止同页切换密钥', async () => {
    const { loadBaiduMap } = await loadModule()
    const first = loadBaiduMap('public-test-ak')
    const second = loadBaiduMap(' public-test-ak ')
    expect(first).toBe(second)
    await vi.dynamicImportSettled()
    expect(scripts).toHaveLength(1)
    expect(new URL(scripts[0]!.src).searchParams.get('v')).toBe('4.0')
    const namespace = sdk()
    complete(scripts[0]!, namespace)
    await expect(first).resolves.toBe(namespace)
    expect(namespace).toHaveProperty('coordType', 'BMAP_COORD_BD09')
    await expect(loadBaiduMap('public-test-ak')).resolves.toBe(namespace)
    await expect(loadBaiduMap('another-public-ak')).rejects.toThrow('请刷新页面')
    expect(scripts).toHaveLength(1)
  })

  it('上游报错不暴露 AK 或请求地址，并可重新加载', async () => {
    const { loadBaiduMap } = await loadModule()
    const failure = loadBaiduMap('public-test-ak')
    const checked = expect(failure).rejects.toThrow(/^交互地图加载失败，请检查网络、浏览器端 AK 和域名白名单后重试。$/)
    await vi.dynamicImportSettled()
    scripts[0]!.onerror!()
    await checked
    const retry = loadBaiduMap('replacement-public-ak')
    await vi.dynamicImportSettled()
    expect(scripts).toHaveLength(2)
    complete(scripts[1]!)
    await expect(retry).resolves.toHaveProperty('Map')
  })

  it('12 秒超时后清除回调，下次请求能重试', async () => {
    const { loadBaiduMap } = await loadModule()
    const failure = loadBaiduMap('public-test-ak')
    const checked = expect(failure).rejects.toThrow('交互地图加载失败')
    await vi.dynamicImportSettled()
    const callback = new URL(scripts[0]!.src).searchParams.get('callback')!
    expect(browser[callback]).toBeTypeOf('function')
    await vi.advanceTimersByTimeAsync(12_000)
    await checked
    expect(browser[callback]).toBeUndefined()
    const retry = loadBaiduMap('public-test-ak')
    await vi.dynamicImportSettled()
    complete(scripts[1]!)
    await expect(retry).resolves.toHaveProperty('Map')
  })

  it('没有可用 SDK 的回调不会永久缓存为加载成功', async () => {
    const { loadBaiduMap } = await loadModule()
    const failure = loadBaiduMap('public-test-ak')
    const checked = expect(failure).rejects.toThrow('交互地图加载失败')
    await vi.dynamicImportSettled()
    complete(scripts[0]!, {})
    await checked
    const retry = loadBaiduMap('public-test-ak')
    await vi.dynamicImportSettled()
    complete(scripts[1]!)
    await expect(retry).resolves.toHaveProperty('Map')
  })
})

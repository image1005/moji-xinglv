/** Browser-only, explicit SDK fixture. It verifies integration, not Baidu basemap accuracy. */
export interface BaiduBrowserFixtureState {
  maps: Array<{
    dragging: boolean
    scrollWheel: boolean
    pinch: boolean
    doubleClick: boolean
    drags: number
    wheels: number
    viewportCalls: number
    zoomCalls: number
    destroyed: boolean
    center: { lng: number; lat: number }
    zoom: number
  }>
}

interface FixturePointerEvent {
  button: number
  target: FixtureElement
  clientX: number
  clientY: number
  deltaY: number
  preventDefault(): void
}
interface FixtureElement {
  clientWidth: number
  clientHeight: number
  className: string
  textContent: string | null
  style: { cssText: string }
  append(...elements: FixtureElement[]): void
  closest(selector: string): FixtureElement | null
  addEventListener(name: string, listener: (event: FixturePointerEvent) => void, options?: { signal: AbortSignal; passive?: boolean }): void
  replaceChildren(): void
}

function installBaiduFixture(callback: string) {
  const scope = globalThis as unknown as Record<string, unknown>
  const browserWindow = globalThis as unknown as { addEventListener: FixtureElement['addEventListener'] }
  const browserDocument = (globalThis as unknown as { document: { getElementById(id: string): FixtureElement | null; createElement(name: string): FixtureElement } }).document
  const state: BaiduBrowserFixtureState = { maps: [] }
  scope.__baiduFixture = state
  class Point { constructor(public lng: number, public lat: number) {} }
  class Pixel { constructor(public x: number, public y: number) {} }
  class Size { constructor(public width: number, public height: number) {} }
  class Polyline {
    constructor(public path: Point[], public options?: Record<string, unknown>) {}
    setPath(path: Point[]) { this.path = path }
  }
  class FixtureMap {
    private container: FixtureElement
    private events = new Map<string, Set<() => void>>()
    private controller = new AbortController()
    private activePointer: { x: number; y: number } | null = null
    private center = new Point(120.15, 30.25)
    private zoom = 13
    private overlays: Polyline[] = []
    private record: BaiduBrowserFixtureState['maps'][number] = {
      dragging: false, scrollWheel: false, pinch: false, doubleClick: false, drags: 0, wheels: 0,
      viewportCalls: 0, zoomCalls: 0, destroyed: false, center: { lng: 120.15, lat: 30.25 }, zoom: 13,
    }
    constructor(element: string | FixtureElement) {
      const container = typeof element === 'string' ? browserDocument.getElementById(element) : element
      if (!container) throw new Error('Map fixture requires a mounted container')
      this.container = container
      state.maps.push(this.record)
      const surface = browserDocument.createElement('div')
      surface.className = 'fixture-baidu-surface'
      surface.style.cssText = 'position:absolute;inset:0;background-color:#e8ebe2;background-image:linear-gradient(#cdd3c6 1px,transparent 1px),linear-gradient(90deg,#cdd3c6 1px,transparent 1px);background-size:64px 64px;'
      const label = browserDocument.createElement('span')
      label.textContent = '隔离地图 SDK 测试底图 · 非真实地图'
      label.style.cssText = 'position:absolute;bottom:8px;left:10px;font:11px sans-serif;color:#657460;pointer-events:none'
      surface.append(label)
      container.append(surface)
      const signal = this.controller.signal
      container.addEventListener('pointerdown', event => {
        if (!this.record.dragging || event.button !== 0 || event.target.closest('button')) return
        this.activePointer = { x: event.clientX, y: event.clientY }
        this.emit('dragstart')
      }, { signal })
      browserWindow.addEventListener('pointermove', event => {
        if (!this.activePointer) return
        const dx = event.clientX - this.activePointer.x, dy = event.clientY - this.activePointer.y
        this.activePointer = { x: event.clientX, y: event.clientY }
        this.center.lng -= dx / this.scale()
        this.center.lat += dy / this.scale()
        this.record.drags++
        this.sync()
        this.emit('moving'); this.emit('dragging')
      }, { signal })
      browserWindow.addEventListener('pointerup', () => {
        if (!this.activePointer) return
        this.activePointer = null
        this.emit('dragend'); this.emit('moveend')
      }, { signal })
      container.addEventListener('wheel', event => {
        if (!this.record.scrollWheel) return
        event.preventDefault()
        this.record.wheels++
        this.setZoom(this.zoom + (event.deltaY < 0 ? 1 : -1))
      }, { signal, passive: false })
      container.addEventListener('dblclick', () => { if (this.record.doubleClick) this.setZoom(this.zoom + 1) }, { signal })
    }
    private scale() { return 256 * 2 ** this.zoom / 360 }
    private sync() { this.record.center = { lng: this.center.lng, lat: this.center.lat }; this.record.zoom = this.zoom }
    private emit(name: string) { for (const listener of this.events.get(name) ?? []) listener() }
    enableDragging() { this.record.dragging = true }
    enableScrollWheelZoom() { this.record.scrollWheel = true }
    enablePinchToZoom() { this.record.pinch = true }
    enableDoubleClickZoom() { this.record.doubleClick = true }
    disableDragging() { this.record.dragging = false }
    getCenter() { return new Point(this.center.lng, this.center.lat) }
    getZoom() { return this.zoom }
    getViewport(points: Point[], options?: { margins?: number[] }) {
      this.record.viewportCalls++
      if (!points.length) return { center: this.getCenter(), zoom: this.zoom }
      const minLng = Math.min(...points.map(point => point.lng)), maxLng = Math.max(...points.map(point => point.lng))
      const minLat = Math.min(...points.map(point => point.lat)), maxLat = Math.max(...points.map(point => point.lat))
      const margins = options?.margins ?? [60, 60, 60, 60]
      const width = Math.max(100, this.container.clientWidth - (margins[1] ?? 60) - (margins[3] ?? 60))
      const height = Math.max(100, this.container.clientHeight - (margins[0] ?? 60) - (margins[2] ?? 60))
      const zoom = Math.min(17, Math.max(3, Math.floor(Math.min(
        Math.log2(width * 360 / (256 * Math.max(0.002, maxLng - minLng))),
        Math.log2(height * 360 / (256 * Math.max(0.002, maxLat - minLat))),
      ))))
      return { center: new Point((minLng + maxLng) / 2, (minLat + maxLat) / 2), zoom }
    }
    centerAndZoom(center: Point, zoom: number) {
      this.center = new Point(center.lng, center.lat); this.zoom = zoom; this.sync()
      this.emit('moving'); this.emit('moveend'); this.emit('zoomend')
      queueMicrotask(() => { this.emit('load'); this.emit('tilesloaded') })
    }
    setZoom(zoom: number) {
      this.record.zoomCalls++
      this.zoom = Math.max(3, Math.min(19, zoom)); this.sync()
      this.emit('zoomstart'); this.emit('zoomend'); this.emit('tilesloaded')
    }
    panTo(center: Point) { this.center = new Point(center.lng, center.lat); this.sync(); this.emit('moving'); this.emit('moveend') }
    panBy(x: number, y: number) {
      this.center.lng -= x / this.scale(); this.center.lat += y / this.scale(); this.sync()
      this.emit('moving'); this.emit('moveend')
    }
    pointToPixel(point: Point) { return new Pixel(this.container.clientWidth / 2 + (point.lng - this.center.lng) * this.scale(), this.container.clientHeight / 2 - (point.lat - this.center.lat) * this.scale()) }
    addOverlay(overlay: Polyline) { this.overlays.push(overlay) }
    removeOverlay(overlay: Polyline) { this.overlays = this.overlays.filter(value => value !== overlay) }
    clearOverlays() { this.overlays = [] }
    checkResize() { this.emit('resize') }
    addEventListener(name: string, listener: () => void) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name)!.add(listener) }
    removeEventListener(name: string, listener: () => void) { this.events.get(name)?.delete(listener) }
    destroy() { this.controller.abort(); this.events.clear(); this.container.replaceChildren(); this.record.destroyed = true }
  }
  scope.BMap = { Map: FixtureMap, Point, Pixel, Size, Polyline }
  const onLoad = scope[callback]
  if (typeof onLoad !== 'function') throw new Error('Expected official Baidu callback parameter')
  onLoad()
}

export function baiduBrowserFixture(callback: string) {
  if (!/^[A-Za-z_$][\w$]*$/.test(callback)) throw new Error('Unexpected SDK callback name')
  return `(${installBaiduFixture.toString()})(${JSON.stringify(callback)});`
}

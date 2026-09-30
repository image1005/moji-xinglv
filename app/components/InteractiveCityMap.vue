<script setup lang="ts">
import { groupMapPlaces, type CityMapPlace } from '#shared/utils/city-map'
import { hasCoordinates } from '#shared/utils/routes'
import { loadBaiduMap } from '~/utils/baidu-map'

const props = defineProps<{
  places: CityMapPlace[]
  center: { lng: number; lat: number } | null
  selectedKey: string
  scopeKey: string
  drawRoute: boolean
  fallbackUrl: string
}>()
const emit = defineEmits<{ select: [key: string]; availability: [ready: boolean] }>()
const config = useRuntimeConfig()
const browserAk = computed(() => String(config.public.baiduMapBrowserAk || '').trim())
const viewport = ref<HTMLElement | null>(null)
const host = ref<HTMLElement | null>(null)
const state = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const failure = ref('')
const active = ref(false)
const visible = ref(false)
const zoom = ref(12)
const groups = shallowRef<ReturnType<typeof groupMapPlaces>>([])
const segments = shallowRef<string[]>([])
const cluster = ref<CityMapPlace[]>([])
const located = computed(() => props.places.filter((place): place is CityMapPlace & { lng: number; lat: number } => hasCoordinates(place)))
const geometryKey = computed(() => located.value.map(place => `${place.key}:${place.lng},${place.lat}`).join('|') + `/${props.center?.lng},${props.center?.lat}`)
let sdk: typeof BMap | undefined
let map: BMap.Map | undefined
let observer: IntersectionObserver | undefined
let resize: ResizeObserver | undefined
let generation = 0
let frame = 0
let loadTimer: ReturnType<typeof setTimeout> | undefined
const interacted = ref(false)
const events = ['moving', 'moveend', 'zooming', 'zoomend', 'resize'] as const

function updatePositions() {
  frame = 0
  if (!map || !sdk || !viewport.value) return
  const { clientWidth: width, clientHeight: height } = viewport.value
  const projected = props.places.map(place => ({ place, pixel: hasCoordinates(place) ? map!.pointToPixel(new sdk!.Point(place.lng, place.lat)) : null }))
  groups.value = groupMapPlaces(projected.flatMap(({ place, pixel }) => pixel && Number.isFinite(pixel.x) && Number.isFinite(pixel.y)
    && pixel.x >= 24 && pixel.x <= width - 24 && pixel.y >= 24 && pixel.y <= height - 38 ? [{ place, x: pixel.x, y: pixel.y }] : []), 46)
  // A missing location breaks the line; never invent continuity through an unknown stop.
  const lines: string[] = []
  let line: string[] = []
  let day = -1
  for (const { place, pixel } of projected) {
    if (!pixel || day !== place.dayIndex) { if (line.length > 1) lines.push(line.join(' ')); line = [] }
    if (pixel) line.push(`${pixel.x},${pixel.y}`)
    day = place.dayIndex
  }
  if (line.length > 1) lines.push(line.join(' '))
  segments.value = props.drawRoute ? lines : []
  zoom.value = map.getZoom()
}
function schedulePositions() { if (!frame) frame = requestAnimationFrame(updatePositions) }
function clearLoadTimer() { if (loadTimer) clearTimeout(loadTimer); loadTimer = undefined }
function tilesReady() { clearLoadTimer(); state.value = 'ready'; schedulePositions() }
function dispose() {
  generation++
  clearLoadTimer()
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  resize?.disconnect()
  if (map) {
    for (const event of events) map.removeEventListener(event, schedulePositions)
    map.removeEventListener('tilesloaded', tilesReady)
    map.removeEventListener('style_loaded_error', mapFailed)
    map.removeEventListener('style_loaded_timeout', mapFailed)
    map.destroy()
    map = undefined
  }
  if (host.value) host.value.replaceChildren()
  groups.value = []; segments.value = []; cluster.value = []
}
function mapFailed() {
  dispose()
  state.value = 'error'
  failure.value = '交互地图未能加载，请检查网络或地图授权后重试。'
}
function fitAll() {
  if (!map || !sdk) return
  interacted.value = false
  cluster.value = []
  const points = located.value.map(place => new sdk!.Point(place.lng, place.lat))
  if (points.length > 1) {
    const view = map.getViewport(points, { margins: [75, 65, 75, 65] })
    map.centerAndZoom(view.center, Math.min(16, Math.max(3, view.zoom)))
  } else {
    const point = points[0] ?? (props.center ? new sdk.Point(props.center.lng, props.center.lat) : null)
    if (point) map.centerAndZoom(point, points.length ? 15 : 12)
  }
  schedulePositions()
}
async function start() {
  if (!active.value || !visible.value || !host.value || map || state.value === 'loading') return
  if (!located.value.length && !props.center) return
  if (!browserAk.value) { state.value = 'error'; failure.value = '交互地图尚未启用，当前显示静态预览。'; return }
  state.value = 'loading'; failure.value = ''
  const epoch = ++generation
  try {
    const loaded = await loadBaiduMap(browserAk.value)
    if (epoch !== generation || !active.value || !host.value) return
    sdk = loaded
    map = new loaded.Map(host.value, { enableRotate: false, enableTilt: false, enableRotateGestures: false, enableTiltGestures: false, enableMapClick: false, minZoom: 3, maxZoom: 19 })
    map.enableDragging(); map.enableScrollWheelZoom(); map.enablePinchToZoom(); map.enableDoubleClickZoom()
    for (const event of events) map.addEventListener(event, schedulePositions)
    map.addEventListener('tilesloaded', tilesReady)
    map.addEventListener('style_loaded_error', mapFailed)
    map.addEventListener('style_loaded_timeout', mapFailed)
    loadTimer = setTimeout(mapFailed, 15_000)
    fitAll()
    if (props.selectedKey) focusPlace(props.selectedKey)
    resize = new ResizeObserver(() => { map?.checkResize(); schedulePositions() })
    resize.observe(host.value)
  } catch {
    if (epoch === generation) mapFailed()
  }
}
function retry() { dispose(); state.value = 'idle'; void start() }
function focusPlace(key: string) {
  const place = located.value.find(item => item.key === key)
  if (!map || !sdk || !place) return
  interacted.value = true; cluster.value = []
  const point = new sdk.Point(place.lng, place.lat)
  map.panTo(point)
  if (map.getZoom() < 15) map.setZoom(15, { zoomCenter: point })
  schedulePositions()
}
function selectGroup(group: ReturnType<typeof groupMapPlaces>[number]) {
  if (group.places.length === 1) { emit('select', group.places[0]!.key); return }
  cluster.value = group.places
}
function changeZoom(delta: number) {
  if (!map) return
  interacted.value = true
  map.setZoom(Math.min(19, Math.max(3, map.getZoom() + delta)))
  schedulePositions()
}
function onKeydown(event: KeyboardEvent) {
  if (event.target !== event.currentTarget || !map) return
  const shifts: Record<string, [number, number]> = { ArrowLeft: [100, 0], ArrowRight: [-100, 0], ArrowUp: [0, 100], ArrowDown: [0, -100] }
  const shift = shifts[event.key]
  if (shift) { interacted.value = true; map.panBy(...shift) }
  else if (event.key === '+' || event.key === '=') changeZoom(1)
  else if (event.key === '-') changeZoom(-1)
  else if (event.key === 'Home') fitAll()
  else return
  event.preventDefault()
}
const placeTitle = (place: CityMapPlace) => `第 ${place.dayIndex + 1} 日 · 第 ${place.label} 站 · ${place.name}`
const groupTitle = (group: ReturnType<typeof groupMapPlaces>[number]) => group.places.length > 1 ? `此处 ${group.places.length} 项行程，点击展开` : placeTitle(group.places[0]!)
function observe() {
  observer?.disconnect()
  if (!viewport.value) return
  observer = new IntersectionObserver(([entry]) => { visible.value = !!entry?.isIntersecting; if (visible.value) void start() }, { rootMargin: '150px' })
  observer.observe(viewport.value)
}
onMounted(() => { active.value = true; observe() })
onActivated(() => { active.value = true; if (!map) state.value = 'idle'; void nextTick(observe) })
onDeactivated(() => { active.value = false; visible.value = false; observer?.disconnect(); dispose(); state.value = 'idle' })
onBeforeUnmount(() => { active.value = false; observer?.disconnect(); dispose() })
watch(() => props.selectedKey, focusPlace)
watch(() => props.scopeKey, () => { interacted.value = false; cluster.value = []; void nextTick(() => { fitAll(); void start() }) })
watch(geometryKey, () => { if (map) { if (!interacted.value) fitAll(); else schedulePositions() } else if (state.value !== 'error') void start() })
watch(() => props.places, values => {
  const keys = new Set(cluster.value.map(place => place.key))
  cluster.value = values.filter(place => keys.has(place.key))
  if (map) schedulePositions()
})
watch(browserAk, retry)
watch(state, value => emit('availability', value === 'ready'), { immediate: true })
defineExpose({ focusPlace })
</script>

<template>
  <div class="interactive-map" :data-state="state">
    <div ref="viewport" class="interactive-map__viewport" :data-zoom="zoom" tabindex="0" role="group" aria-label="可拖动的城市地图，方向键平移，加减键缩放，Home 查看全部" @keydown="onKeydown" @pointerdown="interacted = true" @wheel.passive="interacted = true">
      <div ref="host" class="interactive-map__host" />
      <template v-if="state === 'ready'">
        <svg class="interactive-map__lines" aria-hidden="true"><g v-for="(line, index) in segments" :key="index"><polyline :points="line" stroke="#fff" stroke-width="8" /><polyline :points="line" stroke="#426b5e" stroke-width="4" stroke-dasharray="8 5" /></g></svg>
        <div class="interactive-map__markers">
          <button v-for="group in groups" :key="group.key" type="button" class="interactive-map__marker" :class="{ 'is-selected': group.places.some(place => place.key === selectedKey), 'is-cluster': group.places.length > 1 }" :style="{ left: `${group.x}px`, top: `${group.y}px`, '--day-color': ['#a63a2f', '#34695c', '#795b24', '#485e8b'][group.places[0]!.dayIndex % 4] }" :aria-label="groupTitle(group)" :title="groupTitle(group)" @click.stop="selectGroup(group)">
            <span>{{ group.places.length > 1 ? group.places.length : group.places[0]!.label }}</span>
            <small v-if="group.places.length > 1">处</small>
            <span v-if="group.places.length === 1 && group.places[0]!.key === selectedKey" class="interactive-map__name">{{ group.places[0]!.name }}</span>
          </button>
        </div>
      </template>
      <div v-if="state === 'idle' || state === 'loading'" class="interactive-map__loading" role="status">{{ state === 'idle' ? '地图待展' : '正在展开城市地图…' }}</div>
      <div v-if="state === 'error'" class="interactive-map__fallback"><CachedImage v-if="fallbackUrl" :src="fallbackUrl" alt="城市静态地图预览" /><p v-else>地图暂不可用，地点清单仍可查看。</p></div>
      <div v-if="state === 'ready'" class="interactive-map__tools" aria-label="地图控制">
        <button type="button" aria-label="放大地图" :disabled="zoom >= 19" @click="changeZoom(1)">+</button>
        <button type="button" aria-label="缩小地图" :disabled="zoom <= 3" @click="changeZoom(-1)">−</button>
        <button type="button" class="interactive-map__fit" @click="fitAll">查看全部地点</button>
      </div>
      <div v-if="cluster.length" class="interactive-map__cluster-card" role="group" aria-label="重叠地点">
        <header><strong>此处 {{ cluster.length }} 项行程</strong><button type="button" aria-label="关闭重叠地点" @click="cluster = []">×</button></header>
        <button v-for="place in cluster" :key="place.key" type="button" @click="emit('select', place.key); focusPlace(place.key)"><span>第 {{ place.dayIndex + 1 }} 日 · {{ place.label }}</span>{{ place.name }}</button>
      </div>
    </div>
    <p v-if="state === 'error'" class="interactive-map__notice" role="status">{{ failure }} 静态预览最多标记前 10 处地点，暂不支持拖动。<button v-if="browserAk" type="button" @click="retry">重新加载地图</button></p>
    <p v-else class="interactive-map__hint">拖动探索 · 滚轮或双指缩放 · 点击编号查看地点</p>
  </div>
</template>

<style scoped>
.interactive-map { min-width: 0; background: var(--bg-card, #fffdf8); }
.interactive-map__viewport { position: relative; height: 440px; overflow: hidden; background: #f0eee7; outline-offset: -3px; }
.interactive-map__viewport:focus-visible { outline: 3px solid var(--bamboo, #426b5e); }
.interactive-map__host, .interactive-map__fallback { position: absolute; inset: 0; }
.interactive-map__host { touch-action: none; }
.interactive-map__lines, .interactive-map__markers { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.interactive-map__lines { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.interactive-map__marker { position: absolute; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center; gap: 2px; min-width: 40px; height: 40px; padding: 0 8px; border: 3px solid #fff; border-radius: 50%; background: var(--day-color); color: #fff; box-shadow: 0 2px 7px #182b374d; font: 700 17px system-ui, sans-serif; cursor: pointer; pointer-events: auto; }
.interactive-map__marker small { font-size: 11px; }
.interactive-map__marker.is-selected { z-index: 2; outline: 3px solid #e9bb56; outline-offset: 2px; }
.interactive-map__marker.is-cluster { border-radius: 12px; min-width: 48px; background: #344e5a; }
.interactive-map__marker:focus-visible, .interactive-map button:focus-visible { outline: 3px solid #bf922f; outline-offset: 3px; }
.interactive-map__name { position: absolute; top: 46px; left: 50%; transform: translateX(-50%); max-width: 200px; width: max-content; padding: 6px 10px; border: 1px solid #dac9a8; border-radius: 4px; background: #fffdf8; color: #2e352f; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 2px 8px #0002; pointer-events: none; }
.interactive-map__tools { position: absolute; top: 14px; right: 14px; display: grid; gap: 6px; justify-items: end; }
.interactive-map__tools button { min-width: 40px; height: 40px; border: 1px solid #d5cebe; border-radius: 4px; background: #fffef9; color: #334b40; box-shadow: 0 2px 7px #0001; font-size: 23px; cursor: pointer; }
.interactive-map__tools button:disabled { opacity: .5; cursor: default; }
.interactive-map__tools .interactive-map__fit { padding: 0 12px; font-size: 12px; }
.interactive-map__loading { position: absolute; inset: 0; display: grid; place-items: center; background: #f4f1e9d9; color: #6b7164; font-size: 13px; }
.interactive-map__notice, .interactive-map__hint { margin: 0; padding: 10px 14px; font-size: 11px; color: var(--text-muted); line-height: 1.8; }
.interactive-map__notice { color: #7e5a28; background: #fbf4e4; }
.interactive-map__notice button { color: #345f51; border: 0; background: none; text-decoration: underline; cursor: pointer; }
.interactive-map__cluster-card { position: absolute; top: 14px; left: 14px; width: min(290px, calc(100% - 100px)); max-height: 290px; overflow-y: auto; border: 1px solid #cfc5b3; border-radius: 5px; background: #fffdf7; box-shadow: 0 4px 16px #0002; padding: 8px 12px; }
.interactive-map__cluster-card header { display: flex; align-items: center; justify-content: space-between; font-size: 13px; padding-bottom: 7px; }
.interactive-map__cluster-card button { border: 0; background: none; color: #304b40; text-align: left; cursor: pointer; }
.interactive-map__cluster-card header button { width: 32px; height: 32px; font-size: 24px; }
.interactive-map__cluster-card > button { display: grid; gap: 5px; padding: 10px 0; border-top: 1px solid #e7e1d5; width: 100%; font-size: 13px; }
.interactive-map__cluster-card > button span { font-size: 11px; color: #786f60; }
.interactive-map__fallback > p { padding: 50px 25px; color: var(--text-muted); font-size: 13px; text-align: center; }
@media (max-width: 640px) { .interactive-map__viewport { height: 360px; }.interactive-map__name { max-width: 160px; } }
</style>

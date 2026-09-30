<script setup lang="ts">
import { layoutVersionTree } from '#shared/utils/version-tree'
import { sourceLabel } from '~/utils/format'
import { versionName } from '~/utils/version-metadata'
import { cameraScale, fitVersionCamera, moveVersionCamera, transformCanvasPoint, type CanvasCamera, type CanvasPoint } from '~/utils/version-camera'

const { versions, currentPlan, errorMessage, loadVersions, loadingVersions, versionsHasMore } = useWorkspace()
const PAD = 28
const viewport = ref<SVGSVGElement | null>(null)
const viewportSize = ref({ width: 900, height: 480 })
const camera = ref<CanvasCamera | null>(null)
const selectedId = ref<number | null>(null)
const focusedId = ref<number | null>(null)
const dragging = ref(false)
const locating = ref(false)
const feedback = ref('')
const layout = computed(() => layoutVersionTree(versions.value))
const metadata = computed(() => new Map(versions.value.map(item => [item.id, item])))
const missingParents = computed(() => new Set(versions.value.filter(item => item.parentVersionId !== null && !metadata.value.has(item.parentVersionId)).map(item => item.id)))
const currentId = computed(() => versions.value.find(item => item.version === currentPlan.value?.version)?.id ?? null)
const selected = computed(() => metadata.value.get(selectedId.value ?? -1) ?? null)
const fitted = computed(() => fitVersionCamera(layout.value, viewportSize.value, PAD))
const view = computed(() => camera.value ?? fitted.value)
const viewBox = computed(() => `${view.value.x} ${view.value.y} ${view.value.width} ${view.value.height}`)
const zoom = computed(() => cameraScale(view.value, viewportSize.value))
const minZoom = computed(() => Math.min(0.1, cameraScale(fitted.value, viewportSize.value) / 2))
const tabStopId = computed(() => focusedId.value ?? currentId.value ?? layout.value.nodes[0]?.id)

interface Pointer { x: number; y: number; originX: number; originY: number; nodeId: number | null }
interface Gesture {
  camera: CanvasCamera
  inverse: Pick<DOMMatrix, 'a' | 'b' | 'c' | 'd' | 'e' | 'f'>
  anchor: CanvasPoint
  distance: number
}
const pointers = new Map<number, Pointer>()
let gesture: Gesture | null = null
let moved = false
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  void loadVersions()
  window.addEventListener('blur', clearGesture)
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return
    const next = { width: entry.contentRect.width, height: entry.contentRect.height }
    if (camera.value) {
      const scale = cameraScale(camera.value, viewportSize.value)
      const width = next.width / scale
      const height = next.height / scale
      camera.value = { x: camera.value.x + (camera.value.width - width) / 2, y: camera.value.y + (camera.value.height - height) / 2, width, height }
    }
    viewportSize.value = next
    clearGesture()
  })
  if (viewport.value) resizeObserver.observe(viewport.value)
})
watch(viewport, (element, previous) => {
  if (previous) resizeObserver?.unobserve(previous)
  if (element) resizeObserver?.observe(element)
})
onActivated(() => { void loadVersions(false, true) })
onDeactivated(() => { clearGesture(); selectedId.value = null })
onBeforeUnmount(() => { resizeObserver?.disconnect(); window.removeEventListener('blur', clearGesture); clearGesture() })
watch(() => currentPlan.value?.revision, () => { void loadVersions() })
watch(() => currentPlan.value?.id, () => {
  clearGesture()
  camera.value = null
  selectedId.value = null
  focusedId.value = null
  feedback.value = ''
})
watch(layout, (next, previous) => {
  if (!next.nodes.length || !previous.nodes.length) { camera.value = null; return }
  // Older pages can move every node in the layout. Preserve the nearest already
  // visible node and the absolute scale instead of fitting the tree again.
  const before = camera.value ?? fitVersionCamera(previous, viewportSize.value, PAD)
  const nextNodes = new Map(next.nodes.map(node => [node.id, node]))
  const center = { x: before.x + before.width / 2 - PAD, y: before.y + before.height / 2 - PAD }
  let anchor = previous.nodes[0]!
  let distance = Infinity
  for (const node of previous.nodes) {
    if (!nextNodes.has(node.id)) continue
    const candidate = Math.hypot(node.x + node.width / 2 - center.x, node.y + node.height / 2 - center.y)
    if (candidate < distance) { distance = candidate; anchor = node }
  }
  const replacement = nextNodes.get(anchor.id)
  if (replacement) camera.value = { ...before, x: before.x + replacement.x - anchor.x, y: before.y + replacement.y - anchor.y }
  else camera.value = null
})

function clampZoom(value: number) { return Math.min(4, Math.max(minZoom.value, value)) }
function resetView() { clearGesture(); camera.value = { ...fitted.value } }

function screenInverse(): Gesture['inverse'] | null {
  const element = viewport.value
  const matrix = element?.getScreenCTM()
  if (!element || !matrix) return null
  const inverse = matrix.inverse()
  const rendered = element.viewBox.baseVal
  // Vue batches viewBox changes. Reconcile with the camera when several wheel
  // events arrive before the DOM is painted; never read a stale scale as current.
  const sx = rendered.width ? view.value.width / rendered.width : 1
  const sy = rendered.height ? view.value.height / rendered.height : 1
  return {
    a: inverse.a * sx, b: inverse.b * sy, c: inverse.c * sx, d: inverse.d * sy,
    e: view.value.x + (inverse.e - rendered.x) * sx,
    f: view.value.y + (inverse.f - rendered.y) * sy,
  }
}

function zoomBy(factor: number, anchor = { x: view.value.x + view.value.width / 2, y: view.value.y + view.value.height / 2 }) {
  const next = clampZoom(zoom.value * factor)
  camera.value = moveVersionCamera(view.value, anchor, anchor, zoom.value / next)
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  if (pointers.size) return
  const inverse = screenInverse()
  if (!inverse) return
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportSize.value.height : 1)
  zoomBy(Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.002), transformCanvasPoint(inverse, { x: event.clientX, y: event.clientY }))
}

function midpoint() {
  const active = [...pointers.values()].slice(0, 2)
  const first = active[0]!
  const second = active[1] ?? first
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
}
function pointerDistance() {
  const [first, second] = [...pointers.values()]
  return first && second ? Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)) : 0
}
function startGesture() {
  const inverse = screenInverse()
  gesture = inverse && pointers.size ? { camera: { ...view.value }, inverse, anchor: transformCanvasPoint(inverse, midpoint()), distance: pointerDistance() } : null
}
function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const target = event.target instanceof Element ? event.target.closest<SVGGElement>('.roadmap__node') : null
  if (!pointers.size) moved = false
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, originX: event.clientX, originY: event.clientY, nodeId: target ? Number(target.dataset.versionId) : null })
  if (pointers.size > 1) moved = true
  target?.focus({ preventScroll: true })
  viewport.value?.setPointerCapture(event.pointerId)
  startGesture()
}
function onPointerMove(event: PointerEvent) {
  const pointer = pointers.get(event.pointerId)
  if (!pointer || !gesture) return
  pointer.x = event.clientX
  pointer.y = event.clientY
  if (Math.hypot(pointer.x - pointer.originX, pointer.y - pointer.originY) > 5) moved = true
  if (!moved) return
  dragging.value = true
  const distance = pointerDistance()
  const initialZoom = cameraScale(gesture.camera, viewportSize.value)
  const nextZoom = clampZoom(initialZoom * (gesture.distance && distance ? distance / gesture.distance : 1))
  camera.value = moveVersionCamera(gesture.camera, gesture.anchor, transformCanvasPoint(gesture.inverse, midpoint()), initialZoom / nextZoom)
}
function onPointerUp(event: PointerEvent) {
  const pointer = pointers.get(event.pointerId)
  if (!pointer) return
  const tap = event.type === 'pointerup' && !moved && pointers.size === 1 && pointer.nodeId !== null
    && Math.hypot(event.clientX - pointer.originX, event.clientY - pointer.originY) <= 5
  pointers.delete(event.pointerId)
  if (viewport.value?.hasPointerCapture(event.pointerId)) viewport.value.releasePointerCapture(event.pointerId)
  dragging.value = false
  if (pointers.size) startGesture()
  else gesture = null
  if (tap) select(pointer.nodeId!)
}
function clearGesture() {
  const ids = [...pointers.keys()]
  pointers.clear()
  gesture = null
  dragging.value = false
  moved = true
  for (const id of ids) if (viewport.value?.hasPointerCapture(id)) viewport.value.releasePointerCapture(id)
}

function select(id: number) { selectedId.value = id; feedback.value = '' }
function nodeName(id: number) {
  const item = metadata.value.get(id)
  return item ? versionName(item) : ''
}
function nodeLines(id: number): string[] {
  const item = metadata.value.get(id)
  const text = item?.name?.trim() || sourceLabel(item?.source ?? 'user')
  const lines = ['']
  let units = 0
  for (const character of text) {
    // Reserve enough room for wide Latin glyphs as well as CJK/emoji names.
    const size = character.codePointAt(0)! > 255 || /[MWmw@%&]/.test(character) ? 2 : /[ilI1 .,':;!|]/.test(character) ? 1 : 1.5
    if (units + size > 22) {
      if (lines.length === 2) { lines[1] = `${lines[1]!.slice(0, -1)}…`; break }
      lines.push(''); units = 0
    }
    lines[lines.length - 1] += character
    units += size
  }
  return lines
}
function centerNode(id: number, readable = false) {
  const node = layout.value.nodes.find(item => item.id === id)
  if (!node) return
  const scale = readable ? Math.max(zoom.value, 0.85) : zoom.value
  const width = viewportSize.value.width / scale
  const height = viewportSize.value.height / scale
  camera.value = { x: node.x + PAD + node.width / 2 - width / 2, y: node.y + PAD + node.height / 2 - height / 2, width, height }
}
function onNodeFocus(id: number) {
  focusedId.value = id
  if (pointers.size) return
  const node = layout.value.nodes.find(item => item.id === id)
  if (!node) return
  const left = node.x + PAD
  const top = node.y + PAD
  if (left < view.value.x || top < view.value.y || left + node.width > view.value.x + view.value.width || top + node.height > view.value.y + view.value.height) centerNode(id, true)
}
async function locateCurrent() {
  const planId = currentPlan.value?.id
  if (!planId || locating.value) return
  locating.value = true
  feedback.value = ''
  try {
    while (currentPlan.value?.id === planId && currentId.value === null && versionsHasMore.value) {
      const count = versions.value.length
      await loadVersions(true)
      if (versions.value.length <= count) break
    }
    if (currentPlan.value?.id !== planId) return
    if (currentId.value !== null) centerNode(currentId.value, true)
    else feedback.value = '尚未找到当前版本，请重试加载历史。'
  } finally { locating.value = false }
}
function onCanvasKeydown(event: KeyboardEvent) {
  if (event.target !== viewport.value) return
  const delta = 48 / zoom.value
  const next = { ...view.value }
  if (event.key === 'ArrowLeft') next.x -= delta
  else if (event.key === 'ArrowRight') next.x += delta
  else if (event.key === 'ArrowUp') next.y -= delta
  else if (event.key === 'ArrowDown') next.y += delta
  else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.25); return }
  else if (event.key === '-') { event.preventDefault(); zoomBy(0.8); return }
  else if (event.key === 'Home') { event.preventDefault(); resetView(); return }
  else if (event.key.toLowerCase() === 'c') { event.preventDefault(); void locateCurrent(); return }
  else return
  event.preventDefault()
  camera.value = next
}
function onNodeKeydown(event: KeyboardEvent, id: number) {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(id); return }
  const node = layout.value.nodes.find(item => item.id === id)
  if (!node || !event.key.startsWith('Arrow')) return
  event.preventDefault()
  event.stopPropagation()
  const candidates = layout.value.nodes.filter(item => {
    if (event.key === 'ArrowUp') return item.depth < node.depth
    if (event.key === 'ArrowDown') return item.depth > node.depth
    return item.depth === node.depth && (event.key === 'ArrowLeft' ? item.x < node.x : item.x > node.x)
  })
  candidates.sort((a, b) => Math.hypot(a.x - node.x, a.y - node.y) - Math.hypot(b.x - node.x, b.y - node.y))
  const next = candidates[0]
  if (!next) return
  focusedId.value = next.id
  centerNode(next.id, true)
  viewport.value?.querySelector<SVGGElement>(`[data-version-id="${next.id}"]`)?.focus({ preventScroll: true })
}
function edgePath(from: { x: number; y: number; width: number; height: number }, to: { x: number; y: number; width: number }) {
  const x1 = from.x + from.width / 2
  const y1 = from.y + from.height
  const x2 = to.x + to.width / 2
  return `M ${x1} ${y1} C ${x1} ${y1 + 22}, ${x2} ${to.y - 22}, ${x2} ${to.y}`
}
</script>

<template>
  <div class="roadmap">
    <div v-if="!versions.length" class="roadmap__empty">{{ loadingVersions ? '正在展开版本路线…' : '暂无版本记录。保存一次行程或让 AI 编辑后，这里会长出你的版本路线。' }}</div>
    <template v-else>
      <div class="roadmap__history">
        <button class="btn btn--small" :disabled="loadingVersions || !versionsHasMore" @click="loadVersions(true)">{{ loadingVersions ? '加载中…' : versionsHasMore ? '加载更早的版本' : '已加载全部历史' }}</button>
        <div class="roadmap__history-status" role="status">
          <span>{{ missingParents.size ? '虚线节点的父版本未加载，不是行程起点。' : versionsHasMore ? '可继续加载更早的历史与分叉。' : '历史已全部加载，分叉均保留。' }}</span>
          <span>{{ currentId === null ? `当前 v${currentPlan?.version} 尚未载入，可点「定位当前」。` : `当前版本 v${currentPlan?.version} 已在图中标记。` }}</span>
        </div>
      </div>
      <div class="roadmap__head">
        <div><span class="roadmap__eyebrow">行笺脉络 · 版本分叉</span><h3>版本路线</h3></div>
        <div class="roadmap__tools" role="group" aria-label="版本画布控制">
          <button type="button" aria-label="放大" :disabled="zoom >= 4" @click="zoomBy(1.25)">＋</button>
          <button type="button" aria-label="缩小" :disabled="zoom <= minZoom" @click="zoomBy(0.8)">−</button>
          <button type="button" @click="resetView">适应全部</button>
          <button type="button" :disabled="locating || loadingVersions" @click="locateCurrent">{{ locating ? '定位中…' : '定位当前' }}</button>
          <button type="button" :disabled="loadingVersions" @click="loadVersions(false, true)">刷新名称</button>
          <span class="roadmap__zoom">{{ Math.round(zoom * 100) }}%</span>
        </div>
      </div>
      <div class="roadmap__canvas" :class="{ 'roadmap__canvas--dragging': dragging }">
        <svg
          ref="viewport" class="roadmap__svg" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" tabindex="0" role="group" aria-label="版本树画布，方向键平移，加减号缩放，Home 适应全部，C 定位当前；Tab 进入节点后方向键选择，回车预览"
          @wheel="onWheel" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" @lostpointercapture="onPointerUp" @keydown="onCanvasKeydown">
          <g :transform="`translate(${PAD} ${PAD})`">
            <path v-for="edge in layout.edges" :key="`${edge.from.id}-${edge.to.id}`" class="roadmap__edge" :d="edgePath(edge.from, edge.to)" />
            <g
              v-for="node in layout.nodes" :key="node.id" class="roadmap__node" :data-version-id="node.id" :data-version="node.version"
              :class="[`roadmap__node--${node.source}`, { 'roadmap__node--current': node.id === currentId, 'roadmap__node--selected': node.id === selectedId, 'roadmap__node--incomplete': missingParents.has(node.id) }]"
              :transform="`translate(${node.x} ${node.y})`" role="button" :tabindex="node.id === tabStopId ? 0 : -1" aria-haspopup="dialog"
              :aria-label="`${nodeName(node.id)}，版本 v${node.version}${node.id === currentId ? '，当前版本' : ''}${missingParents.has(node.id) ? '，更早历史尚未加载' : ''}，预览`"
              @focus="onNodeFocus(node.id)" @click="($event.detail === 0) && select(node.id)" @keydown="onNodeKeydown($event, node.id)">
              <title>{{ nodeName(node.id) }} · v{{ node.version }} · {{ sourceLabel(node.source) }}</title>
              <rect :width="node.width" :height="node.height" rx="5" />
              <text class="roadmap__version" x="13" y="20">v{{ node.version }}</text>
              <text v-if="node.id === currentId" class="roadmap__current" :x="node.width - 13" y="20" text-anchor="end">● 当前</text>
              <text v-for="(line, index) in nodeLines(node.id)" :key="index" class="roadmap__name" x="13" :y="43 + index * 19">{{ line }}</text>
            </g>
          </g>
        </svg>
      </div>
      <p class="roadmap__note">拖动背景、留白或连线平移，滚轮或双指缩放；点击节点预览。键盘：方向键移动，＋/− 缩放，Home 适应全部，C 定位当前。</p>
      <VersionPreviewDialog v-if="selected && currentPlan" :plan-id="currentPlan.id" :version="selected" @close="selectedId = null" />
    </template>
    <p v-if="feedback || errorMessage" class="feedback" role="status">{{ feedback || errorMessage }}</p>
  </div>
</template>

<style scoped>
.roadmap { display: grid; gap: 14px; min-width: 0; }
.roadmap__history { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 12px; align-items: center; }
.roadmap__history > button { min-height: 38px; }
.roadmap__history-status { display: grid; color: var(--text-muted); font-size: 12px; line-height: 1.4; }
.roadmap__history-status > span { display: block; min-height: 2.8em; overflow-wrap: anywhere; }
.roadmap__empty { margin: 16vh auto 0; max-width: 340px; text-align: center; color: var(--ink-faint); font-size: 13px; line-height: 1.9; }
.roadmap__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.roadmap__eyebrow { color: var(--gold-deep); font-size: 10px; letter-spacing: 0.2em; }
.roadmap__head h3 { margin: 6px 0 0; font-size: 21px; font-weight: 500; letter-spacing: 0.08em; }
.roadmap__tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.roadmap__tools button { min-width: 34px; min-height: 34px; padding: 5px 9px; border: 1px solid var(--border-primary); border-radius: 6px; background: var(--bg-card); color: var(--text-secondary); font-size: 12px; cursor: pointer; }
.roadmap__tools button:hover:not(:disabled) { border-color: var(--gold); color: var(--cinnabar); background: var(--bg-card-muted); }
.roadmap__tools button:disabled { opacity: 0.45; cursor: not-allowed; }
.roadmap__tools button:focus-visible { outline: 2px solid var(--bamboo); outline-offset: 2px; }
.roadmap__zoom { color: var(--text-muted); font-size: 11px; min-width: 34px; text-align: right; }
.roadmap__canvas { border: 1px solid var(--border-primary); border-radius: 10px; background: var(--bg-card); height: min(58vh, 560px); min-height: 280px; overflow: hidden; box-shadow: var(--shadow-sm); }
.roadmap__svg { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; user-select: none; }
.roadmap__svg:focus-visible { outline: 2px solid var(--bamboo); outline-offset: -3px; }
.roadmap__canvas--dragging .roadmap__svg, .roadmap__canvas--dragging .roadmap__node { cursor: grabbing; }
.roadmap__edge { fill: none; stroke: var(--border-primary); stroke-width: 2; pointer-events: stroke; }
.roadmap__node { cursor: pointer; }
.roadmap__node rect { fill: var(--bg-card-muted); stroke: var(--border-primary); stroke-width: 1.2; }
.roadmap__node text { fill: var(--text-primary); font-family: var(--font-serif); pointer-events: none; }
.roadmap__name { font-size: 13px; }
.roadmap__node .roadmap__version { font-family: var(--font-sans); font-size: 10px; fill: var(--text-muted); }
.roadmap__current { font-size: 10px; }
.roadmap__node--ai rect { stroke: var(--bamboo); }
.roadmap__node--user rect { stroke: var(--text-secondary); }
.roadmap__node--rollback rect { stroke: var(--gold-deep); }
.roadmap__node--current rect { stroke: var(--cinnabar); stroke-width: 1.8; fill: var(--cinnabar-soft); }
.roadmap__node--current .roadmap__current { fill: var(--cinnabar); }
.roadmap__node--selected rect { stroke-width: 2.4; }
.roadmap__node--incomplete rect { stroke-dasharray: 5 4; }
.roadmap__node:focus-visible { outline: none; }
.roadmap__node:focus-visible rect { stroke: var(--bamboo); stroke-width: 3; }
.roadmap__note { margin: 0; color: var(--text-muted); font-size: 11.5px; line-height: 1.8; }
@media (max-width: 720px) {
  .roadmap__history { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .roadmap__history > button { min-height: 40px; }
  .roadmap__canvas { height: 52dvh; min-height: 300px; }
  .roadmap__head { align-items: center; gap: 12px; }
  .roadmap__tools { width: 100%; }
  .roadmap__tools button { min-height: 40px; }
}
</style>

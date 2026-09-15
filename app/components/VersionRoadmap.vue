<script setup lang="ts">
import { layoutVersionTree } from '#shared/utils/version-tree'
import { formatDateTime, sourceLabel } from '~/utils/format'

const { versions, currentPlan, errorMessage, switchVersion } = useWorkspace()

const PAD = 28
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
const selectedId = ref<number | null>(null)
const switching = ref(false)
const feedback = ref('')
const dragging = ref(false)
const viewport = ref<SVGSVGElement | null>(null)
let origin = { x: 0, y: 0, panX: 0, panY: 0 }
let moved = false

const layout = computed(() => layoutVersionTree(versions.value.map((item) => ({
  id: item.id,
  version: item.version,
  source: item.source,
  parentVersionId: item.parentVersionId,
}))))
const currentId = computed(() => versions.value.find((item) => item.version === currentPlan.value?.version)?.id ?? null)
const selected = computed(() => versions.value.find((item) => item.id === selectedId.value) ?? null)
const base = computed(() => ({
  w: (layout.value.width || 1) + PAD * 2,
  h: (layout.value.height || 1) + PAD * 2,
}))
const view = computed(() => {
  const w = base.value.w / zoom.value
  const h = base.value.h / zoom.value
  return { x: (base.value.w - w) / 2 + pan.value.x, y: (base.value.h - h) / 2 + pan.value.y, w, h }
})
const viewBox = computed(() => `${view.value.x} ${view.value.y} ${view.value.w} ${view.value.h}`)
const message = computed(() => feedback.value || errorMessage.value)

watch(() => currentPlan.value?.id, () => {
  zoom.value = 1
  pan.value = { x: 0, y: 0 }
  selectedId.value = null
  feedback.value = ''
})

function clamp(value: number) {
  return Math.min(3, Math.max(0.4, value))
}

function zoomBy(factor: number) {
  zoom.value = clamp(zoom.value * factor)
}

function resetView() {
  zoom.value = 1
  pan.value = { x: 0, y: 0 }
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  const next = clamp(zoom.value * (event.deltaY < 0 ? 1.15 : 1 / 1.15))
  const element = viewport.value
  if (next === zoom.value || !element) return
  const rect = element.getBoundingClientRect()
  const ratioX = rect.width ? (event.clientX - rect.left) / rect.width : 0.5
  const ratioY = rect.height ? (event.clientY - rect.top) / rect.height : 0.5
  const before = view.value
  const worldX = before.x + ratioX * before.w
  const worldY = before.y + ratioY * before.h
  const width = base.value.w / next
  const height = base.value.h / next
  pan.value = {
    x: worldX - ratioX * width - (base.value.w - width) / 2,
    y: worldY - ratioY * height - (base.value.h - height) / 2,
  }
  zoom.value = next
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  dragging.value = true
  moved = false
  origin = { x: event.clientX, y: event.clientY, panX: pan.value.x, panY: pan.value.y }
  ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  const element = viewport.value
  const rect = element?.getBoundingClientRect()
  const dx = event.clientX - origin.x
  const dy = event.clientY - origin.y
  if (Math.abs(dx) + Math.abs(dy) > 4) moved = true
  const scaleX = rect && rect.width ? view.value.w / rect.width : 1
  const scaleY = rect && rect.height ? view.value.h / rect.height : 1
  pan.value = { x: origin.panX - dx * scaleX, y: origin.panY - dy * scaleY }
}

function onPointerUp() {
  dragging.value = false
}

function select(id: number) {
  if (moved) return
  selectedId.value = selectedId.value === id ? null : id
  feedback.value = ''
}

function edgePath(from: { x: number; y: number; width: number; height: number }, to: { x: number; y: number; width: number }) {
  const x1 = from.x + from.width / 2
  const y1 = from.y + from.height
  const x2 = to.x + to.width / 2
  const y2 = to.y
  return `M ${x1} ${y1} C ${x1} ${y1 + 22}, ${x2} ${y2 - 22}, ${x2} ${y2}`
}

async function doSwitch() {
  const target = selected.value
  if (!target || switching.value || target.version === currentPlan.value?.version) return
  if (!window.confirm(`切换到 v${target.version}？当前版本将变为 v${target.version}，历史版本仍保留。`)) return
  switching.value = true
  feedback.value = ''
  try {
    if (await switchVersion(target.version) !== null) {
      feedback.value = `已切换到 v${target.version}`
      selectedId.value = null
    }
  } finally {
    switching.value = false
  }
}
</script>

<template>
  <div class="roadmap">
    <div v-if="!versions.length" class="roadmap__empty">
      暂无版本记录。保存一次行程或让 AI 编辑后，这里会长出你的版本路线。
    </div>
    <template v-else>
      <div class="roadmap__head">
        <div>
          <span class="roadmap__eyebrow">行笺脉络 · 版本分叉</span>
          <h3>版本路线</h3>
        </div>
        <div class="roadmap__tools">
          <button type="button" aria-label="放大" :disabled="zoom >= 3" @click="zoomBy(1.25)">＋</button>
          <button type="button" aria-label="缩小" :disabled="zoom <= 0.4" @click="zoomBy(0.8)">−</button>
          <button type="button" @click="resetView">适应</button>
          <span class="roadmap__zoom">{{ Math.round(zoom * 100) }}%</span>
        </div>
      </div>
      <div class="roadmap__canvas" :class="{ 'roadmap__canvas--dragging': dragging }">
        <svg
          ref="viewport"
          class="roadmap__svg"
          :viewBox="viewBox"
          preserveAspectRatio="xMidYMid meet"
          @wheel="onWheel"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointerleave="onPointerUp"
        >
          <g :transform="`translate(${PAD} ${PAD})`">
            <path v-for="(edge, index) in layout.edges" :key="`e-${index}`" class="roadmap__edge" :d="edgePath(edge.from, edge.to)" />
            <g
              v-for="node in layout.nodes"
              :key="node.id"
              class="roadmap__node"
              :class="[`roadmap__node--${node.source}`, { 'roadmap__node--current': node.id === currentId, 'roadmap__node--selected': node.id === selectedId }]"
              :transform="`translate(${node.x} ${node.y})`"
              role="button"
              tabindex="0"
              :aria-label="`版本 v${node.version}`"
              @click="select(node.id)"
              @keydown.enter.prevent="select(node.id)"
            >
              <rect :width="node.width" :height="node.height" rx="7" />
              <text x="32" y="22" text-anchor="middle">v{{ node.version }}</text>
              <circle v-if="node.id === currentId" class="roadmap__dot" cx="55" cy="10" r="3" />
            </g>
          </g>
        </svg>
      </div>
      <div v-if="selected" class="roadmap__detail">
        <div>
          <strong>v{{ selected.version }}</strong>
          <span>{{ sourceLabel(selected.source) }}</span>
          <span>{{ formatDateTime(selected.createdAt) }}</span>
          <span>变更 {{ selected.diffJson?.length ?? 0 }} 处</span>
        </div>
        <button
          type="button"
          class="btn btn--seal btn--small"
          :disabled="switching || selected.version === currentPlan?.version"
          @click="doSwitch"
        >
          {{ selected.version === currentPlan?.version ? '当前版本' : switching ? '切换中…' : '切换到此版本' }}
        </button>
      </div>
      <p class="roadmap__note">节点是历史版本；切换只移动「当前版本」指针，不新建也不删除版本。滚轮缩放、拖拽平移，点击节点查看详情。</p>
      <p v-if="message" class="feedback" role="status">{{ message }}</p>
    </template>
  </div>
</template>

<style scoped>
.roadmap { display: grid; gap: 14px; }
.roadmap__empty { margin: 16vh auto 0; max-width: 340px; text-align: center; color: var(--ink-faint); font-size: 13px; line-height: 1.9; }
.roadmap__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.roadmap__eyebrow { color: var(--gold-deep); font-size: 10px; letter-spacing: 0.2em; }
.roadmap__head h3 { margin: 6px 0 0; font-size: 21px; font-weight: 500; letter-spacing: 0.08em; }
.roadmap__tools { display: flex; align-items: center; gap: 6px; }
.roadmap__tools button { min-width: 30px; height: 28px; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); color: var(--ink-soft); font-size: 13px; cursor: pointer; }
.roadmap__tools button:hover:not(:disabled) { border-color: var(--gold); color: var(--cinnabar); }
.roadmap__tools button:disabled { opacity: 0.45; cursor: not-allowed; }
.roadmap__zoom { color: var(--ink-faint); font-size: 11px; min-width: 34px; text-align: right; }
.roadmap__canvas { border: 1px solid var(--line); border-radius: 8px; background: var(--paper-white); height: min(46vh, 420px); overflow: hidden; }
.roadmap__canvas--dragging { cursor: grabbing; }
.roadmap__svg { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; user-select: none; }
.roadmap__edge { fill: none; stroke: var(--line); stroke-width: 1.2; }
.roadmap__node { cursor: pointer; }
.roadmap__node rect { fill: var(--paper); stroke: var(--ink-faint); stroke-width: 1.2; }
.roadmap__node text { fill: var(--ink); font-family: var(--font-serif); font-size: 13px; }
.roadmap__node--ai rect { stroke: var(--bamboo); }
.roadmap__node--user rect { stroke: var(--ink-soft); }
.roadmap__node--rollback rect { stroke: var(--gold-deep); }
.roadmap__node--current rect { stroke: var(--cinnabar); stroke-width: 1.8; fill: var(--cinnabar-soft); }
.roadmap__node--current text { fill: var(--cinnabar); }
.roadmap__node--selected rect { stroke-width: 2.4; }
.roadmap__dot { fill: var(--cinnabar); }
.roadmap__node:focus-visible { outline: none; }
.roadmap__node:focus-visible rect { stroke: var(--bamboo); stroke-width: 2.4; }
.roadmap__detail { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 16px; border: 1px solid var(--line); border-left: 3px solid var(--cinnabar); border-radius: 5px; background: var(--paper); }
.roadmap__detail > div { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--ink-soft); }
.roadmap__detail strong { font-family: var(--font-serif); font-size: 15px; color: var(--cinnabar); }
.roadmap__note { margin: 0; color: var(--ink-faint); font-size: 11px; line-height: 1.9; }
@media (max-width: 720px) { .roadmap__canvas { height: 300px; } .roadmap__head { align-items: center; } }
</style>

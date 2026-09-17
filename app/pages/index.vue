<script setup lang="ts">
definePageMeta({ middleware: 'auth', keepalive: true })

const { currentPlan, bootstrap, uiLeftOpen } = useWorkspace()
const { loadMe } = useCurrentUser()
const mobile = useState('workspace-mobile', () => false)
const isSidebarCollapsed = useState('sidebar-collapsed', () => false)
const sidebarWidth = useState('sidebar-width', () => 268)
const viewportHeight = ref<number | null>(null)
const dragging = ref(false)

function resizeViewport() { viewportHeight.value = window.visualViewport?.height ?? null }

onMounted(() => {
  resizeViewport()
  window.visualViewport?.addEventListener('resize', resizeViewport)
  if (import.meta.client) {
    try {
      const saved = localStorage.getItem('shanhai_sidebar_width')
      if (saved) {
        const parsed = parseInt(saved, 10)
        if (!isNaN(parsed) && parsed >= 220 && parsed <= 520) {
          sidebarWidth.value = parsed
        }
      }
    } catch {
      // ignore storage error
    }
  }
})

onBeforeUnmount(() => window.visualViewport?.removeEventListener('resize', resizeViewport))

// 首次进入（含 SSR 注水后）加载数据；从其他页面返回时命中 KeepAlive 缓存，不重复请求
let bootPromise: Promise<void> | null = null
function ensureBootstrap() {
  if (currentPlan.value) return Promise.resolve()
  bootPromise ??= bootstrap().finally(() => {
    bootPromise = null
  })
  return bootPromise
}

onMounted(() => void ensureBootstrap())
onActivated(() => {
  void ensureBootstrap()
  void loadMe()
})

function closeDrawer() {
  uiLeftOpen.value = false
}

// ---- 拖拽手柄逻辑（指针捕获 + rAF 节流，对齐 BloomHarness / dsh 规范） ----
let originX = 0
let baseWidth = 0
let pendingDx = 0
let dragRaf = 0

function clamp(px: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(px)))
}

function onHandleDown(event: PointerEvent) {
  if (isSidebarCollapsed.value || mobile.value) return
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  originX = event.clientX
  baseWidth = sidebarWidth.value
  dragging.value = true
}

function onHandleMove(event: PointerEvent) {
  if (!dragging.value) return
  pendingDx = event.clientX - originX
  if (!dragRaf) {
    dragRaf = requestAnimationFrame(() => {
      dragRaf = 0
      sidebarWidth.value = clamp(baseWidth + pendingDx, 220, 520)
    })
  }
}

function onHandleUp(event: PointerEvent) {
  if (!dragging.value) return
  const target = event.currentTarget as HTMLElement
  try {
    target.releasePointerCapture(event.pointerId)
  } catch {
    // capture released
  }
  dragging.value = false
  if (import.meta.client) {
    try {
      localStorage.setItem('shanhai_sidebar_width', String(sidebarWidth.value))
    } catch {
      // ignore
    }
  }
}
</script>

<template>
  <div
    class="workbench"
    :data-dragging="dragging || undefined"
    :style="{
      ...(mobile && viewportHeight ? { height: `${viewportHeight}px` } : {}),
      '--sidebar-width': `${sidebarWidth}px`,
    }"
  >
    <WorkspaceSidebar />

    <!-- 桌面端拖拽调节宽度分割线 (BloomHarness 模式) -->
    <div
      v-if="!isSidebarCollapsed && !mobile"
      class="workbench__handle"
      role="separator"
      aria-orientation="vertical"
      title="按住左右拖动，调整对话区域宽度"
      @pointerdown="onHandleDown"
      @pointermove="onHandleMove"
      @pointerup="onHandleUp"
      @pointercancel="onHandleUp"
    >
      <div class="workbench__handle-bar" />
    </div>

    <MainPanel :inert="mobile && uiLeftOpen" />
    <div v-if="uiLeftOpen" class="workbench__overlay" aria-hidden="true" @click="closeDrawer" />
  </div>
</template>

<style lang="scss" scoped>
@use "~/assets/styles/variables" as *;

.workbench {
  height: 100vh;
  height: 100dvh;
  display: flex;
  overflow: hidden;
  position: relative;
  background: var(--bg-page);
}

.workbench__handle {
  position: relative;
  width: 8px;
  margin-left: -4px;
  margin-right: -4px;
  cursor: col-resize;
  z-index: 25;
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  flex-shrink: 0;

  .workbench__handle-bar {
    width: 2px;
    height: 100%;
    background-color: transparent;
    transition: background-color $dur-fast $ease-soft;
  }

  &:hover .workbench__handle-bar,
  &:active .workbench__handle-bar {
    background-color: var(--cinnabar);
  }
}

.workbench[data-dragging] {
  user-select: none;
  cursor: col-resize;

  .workbench__handle-bar {
    background-color: var(--cinnabar) !important;
  }

  :deep(.ws) {
    transition: none !important;
  }
}

.workbench__overlay {
  display: none;
}

@media (max-width: 960px) {
  .workbench__overlay {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(43, 43, 43, 0.35);
    z-index: 30;
  }
}
</style>

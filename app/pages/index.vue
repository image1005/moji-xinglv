<script setup lang="ts">
definePageMeta({ middleware: 'auth', keepalive: true })

const { currentPlan, bootstrap, uiLeftOpen } = useWorkspace()
const { loadMe } = useCurrentUser()

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
</script>

<template>
  <div class="workbench">
    <WorkspaceSidebar />
    <MainPanel />
    <div v-if="uiLeftOpen" class="workbench__overlay" @click="closeDrawer" />
  </div>
</template>

<style scoped>
.workbench {
  height: 100vh;
  display: flex;
  overflow: hidden;
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

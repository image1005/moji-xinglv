<script setup lang="ts">
import { fetchBlobCached } from '~/utils/idb'

const props = defineProps<{ src: string; alt?: string }>()
const { user } = useCurrentUser()
const objectUrl = ref('')
const state = ref<'loading' | 'ready' | 'error'>('loading')
const container = ref<HTMLElement | null>(null)
const active = ref(false)
const visible = ref(false)
const retryKey = ref(0)
let observer: IntersectionObserver | null = null

function observe() {
  observer?.disconnect()
  if (!container.value || !active.value) return
  if (typeof IntersectionObserver === 'undefined') { visible.value = true; return }
  observer = new IntersectionObserver(([entry]) => { visible.value = !!entry?.isIntersecting })
  observer.observe(container.value)
}
onMounted(() => { active.value = true; observe() })
onActivated(() => { active.value = true; void nextTick(observe) })
onDeactivated(() => { active.value = false; visible.value = false; observer?.disconnect() })
onBeforeUnmount(() => observer?.disconnect())

watch(
  [() => props.src, () => user.value?.id, active, visible, retryKey],
  async ([src], _previous, onCleanup) => {
    if (!import.meta.client || !active.value || !visible.value) return
    const controller = new AbortController()
    let requestActive = true
    let ownedUrl = ''
    onCleanup(() => {
      requestActive = false
      controller.abort()
      if (ownedUrl) URL.revokeObjectURL(ownedUrl)
      if (objectUrl.value === ownedUrl) objectUrl.value = ''
    })
    objectUrl.value = ''
    state.value = src ? 'loading' : 'error'
    if (!src) return
    try {
      const blob = await fetchBlobCached(src, undefined, controller.signal)
      if (!requestActive) return
      ownedUrl = URL.createObjectURL(blob)
      objectUrl.value = ownedUrl
      state.value = 'ready'
    } catch {
      if (requestActive) state.value = 'error'
    }
  },
  { immediate: true, flush: 'sync' },
)
</script>

<template>
  <div ref="container" class="cached-image-frame">
    <img v-if="state === 'ready' && objectUrl" :src="objectUrl" :alt="alt ?? ''" class="cached-image" decoding="async" @error="state = 'error'" >
    <div v-else class="cached-image cached-image--placeholder">
      <span v-if="state === 'loading'">{{ visible ? '墨迹加载中…' : '风景待展' }}</span>
      <span v-else>图像暂未加载 <button type="button" @click="retryKey++">重试</button></span>
    </div>
  </div>
</template>

<style scoped>
.cached-image-frame { width: 100%; height: 100%; min-height: 60px; }
.cached-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: var(--paper-deep);
}
.cached-image--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-faint);
  font-size: 12px;
  letter-spacing: 0.1em;
  min-height: 60px;
}
.cached-image--placeholder button { border: 0; background: transparent; color: var(--bamboo); cursor: pointer; }
</style>

<script setup lang="ts">
import { fetchBlobCached } from '~/utils/idb'

const props = defineProps<{ src: string; alt?: string }>()
const { user } = useCurrentUser()
const objectUrl = ref('')
const state = ref<'loading' | 'ready' | 'error'>('loading')

watch(
  [() => props.src, () => user.value?.id],
  async ([src], _previous, onCleanup) => {
    if (!import.meta.client) return
    const controller = new AbortController()
    let active = true
    let ownedUrl = ''
    onCleanup(() => {
      active = false
      controller.abort()
      if (ownedUrl) URL.revokeObjectURL(ownedUrl)
      if (objectUrl.value === ownedUrl) objectUrl.value = ''
    })
    objectUrl.value = ''
    state.value = src ? 'loading' : 'error'
    if (!src) return
    try {
      const blob = await fetchBlobCached(src, undefined, controller.signal)
      if (!active) return
      ownedUrl = URL.createObjectURL(blob)
      objectUrl.value = ownedUrl
      state.value = 'ready'
    } catch {
      if (active) state.value = 'error'
    }
  },
  { immediate: true },
)
</script>

<template>
  <img v-if="state === 'ready' && objectUrl" :src="objectUrl" :alt="alt ?? ''" class="cached-image" @error="state = 'error'" >
  <div v-else class="cached-image cached-image--placeholder">
    <span v-if="state === 'loading'">墨迹加载中…</span>
    <span v-else>暂无图像</span>
  </div>
</template>

<style scoped>
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
</style>

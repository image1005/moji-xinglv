<script setup lang="ts">
const props = defineProps<{ src: string; alt?: string }>()

const objectUrl = ref('')
const state = ref<'loading' | 'ready' | 'error'>('loading')

watch(
  () => props.src,
  async (src) => {
    if (!import.meta.client) return
    if (!src) {
      state.value = 'error'
      return
    }
    state.value = 'loading'
    if (objectUrl.value) {
      URL.revokeObjectURL(objectUrl.value)
      objectUrl.value = ''
    }
    try {
      const blob = await fetchBlobCached(src)
      objectUrl.value = URL.createObjectURL(blob)
      state.value = 'ready'
    } catch {
      state.value = 'error'
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
})
</script>

<template>
  <img v-if="state === 'ready' && objectUrl" :src="objectUrl" :alt="alt ?? ''" class="cached-image" >
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

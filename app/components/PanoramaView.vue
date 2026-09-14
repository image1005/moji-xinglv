<script setup lang="ts">
import { api } from '~/utils/api'

const { currentPlan } = useWorkspace()

const spots = computed(() => currentPlan.value?.plan.days.flatMap((d) => d.spots) ?? [])
const index = ref(0)
const heading = ref(0)
const fov = ref(90)

const spot = computed(() => spots.value[index.value] ?? null)

const url = computed(() => {
  if (!spot.value) return ''
  return api.panoramaUrl({
    location: `${spot.value.lng},${spot.value.lat}`,
    heading: heading.value,
    fov: fov.value,
    width: 800,
    height: 480,
  })
})

watch(
  () => currentPlan.value?.id,
  () => {
    index.value = 0
    heading.value = 0
    fov.value = 90
  },
)
</script>

<template>
  <div class="panorama-view">
    <div v-if="!spots.length" class="panorama-view__empty">行程中还没有景点，先在对话里生成一版吧</div>
    <template v-else>
      <label class="panorama-view__select">
        景点
        <select v-model.number="index">
          <option v-for="(item, i) in spots" :key="i" :value="i">
            {{ item.name }}
          </option>
        </select>
      </label>
      <div class="panorama-view__frame">
        <CachedImage :src="url" :alt="`${spot?.name} 街景`" />
      </div>
      <p v-if="spot?.notes" class="panorama-view__notes">{{ spot.notes }}</p>
      <div class="panorama-view__sliders">
        <label>
          视角 {{ heading }}°
          <input v-model.number="heading" type="range" min="0" max="360" step="5" >
        </label>
        <label>
          视野 {{ fov }}°
          <input v-model.number="fov" type="range" min="20" max="180" step="5" >
        </label>
      </div>
      <p class="panorama-view__note">
        街景图片经服务端代理并写入 SQLite / 前端 IndexedDB 双层缓存，重复查看不再请求百度。
      </p>
    </template>
  </div>
</template>

<style scoped>
.panorama-view {
  display: grid;
  gap: 10px;
}
.panorama-view__empty {
  color: var(--ink-faint);
  font-size: 13px;
  text-align: center;
  padding: 30px 0;
}
.panorama-view__select {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-soft);
}
.panorama-view__select select {
  flex: 1;
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 5px 8px;
  background: var(--paper);
  font-size: 13px;
  font-family: inherit;
}
.panorama-view__frame {
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
  aspect-ratio: 800 / 480;
  background: var(--paper);
}
.panorama-view__notes {
  margin: 0;
  font-size: 12px;
  color: var(--ink-soft);
}
.panorama-view__sliders {
  display: grid;
  gap: 8px;
}
.panorama-view__sliders label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--ink-faint);
}
.panorama-view__note {
  margin: 0;
  font-size: 12px;
  color: var(--ink-faint);
  line-height: 1.7;
}
</style>

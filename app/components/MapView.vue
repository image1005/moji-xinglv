<script setup lang="ts">
const { currentPlan } = useWorkspace()

const url = computed(() => {
  const plan = currentPlan.value?.plan
  if (!plan) return ''
  const spots = plan.days.flatMap((d) => d.spots).filter((s) => s.lng && s.lat)
  if (!spots.length) return ''
  const lng = spots.reduce((sum, s) => sum + s.lng, 0) / spots.length
  const lat = spots.reduce((sum, s) => sum + s.lat, 0) / spots.length
  const params = new URLSearchParams({
    center: `${lng.toFixed(6)},${lat.toFixed(6)}`,
    zoom: '12',
    width: '800',
    height: '520',
    scale: '2',
    pathStyles: '0x4a7264,4,0.85',
  })
  for (const spot of spots.slice(0, 40)) params.append('markers', `${spot.lng},${spot.lat}`)
  for (const day of plan.days) {
    const points = day.spots.filter((s) => s.lng && s.lat).map((s) => `${s.lng},${s.lat}`)
    if (points.length >= 2) params.append('paths', points.join(';'))
  }
  return `/api/staticmap?${params.toString()}`
})
</script>

<template>
  <div class="map-view">
    <div class="map-view__frame">
      <CachedImage v-if="url" :src="url" alt="行程路线静态地图" />
      <div v-else class="map-view__empty">行程中还没有可用的景点坐标</div>
    </div>
    <p class="map-view__note">
      静态路线图由服务端代理百度静态图 API 生成并缓存，前端不持有 AK；标记点为景点，连线为每日顺序。
    </p>
  </div>
</template>

<style scoped>
.map-view__frame {
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
  background: var(--paper);
  aspect-ratio: 800 / 520;
}
.map-view__empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-faint);
  font-size: 13px;
}
.map-view__note {
  margin-top: 10px;
  font-size: 12px;
  color: var(--ink-faint);
  line-height: 1.7;
}
</style>

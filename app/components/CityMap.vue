<script setup lang="ts">
import type { Plan } from '#shared/schemas/plan'
import type { PlanResource } from '#shared/schemas/media'
import { hasCoordinates, staticMapUrl, type LocatedSpot } from '#shared/utils/routes'

const props = defineProps<{ plan: Plan; resources: PlanResource[] }>()
const city = ref('')
const selectedDay = ref('all')
const cities = computed(() => [...new Set(props.plan.days.map(day => day.city).filter(Boolean))])
const days = computed(() => props.plan.days.map((day, index) => ({ day, index })).filter(({ day }) => day.city === city.value))
watch(cities, values => { if (!values.includes(city.value)) city.value = values[0] ?? '' }, { immediate: true })
watch(city, () => { selectedDay.value = 'all' })
const spots = computed(() => days.value.filter(({ index }) => selectedDay.value === 'all' || selectedDay.value === String(index)).flatMap(({ day }) => day.spots))
const located = computed(() => spots.value.flatMap((spot) => {
  const trusted = props.resources.find(item => item.entityId === `spot:${spot.id}`)?.location
  const value = trusted ? { ...spot, lng: trusted.lng, lat: trusted.lat } : spot
  return hasCoordinates(value) ? [value as LocatedSpot] : []
}))
const cityResource = computed(() => props.resources.find(item => item.entityType === 'city' && item.city === city.value))
const url = computed(() => {
  const center = cityResource.value?.location
  const result = located.value.length ? staticMapUrl(located.value) : center ? `/api/staticmap?${new URLSearchParams({ center: `${center.lng},${center.lat}`, zoom: '12', width: '800', height: '480', scale: '1' })}` : ''
  if (!result || selectedDay.value !== 'all') return result
  const params = new URLSearchParams(result.split('?')[1])
  params.delete('paths')
  params.delete('pathStyles')
  return `/api/staticmap?${params.toString()}`
})
const locationSources = computed(() => [...new Map(props.resources.filter(item => item.city === city.value && item.location).map(item => [item.location!.provider, item.location!])).values()])
</script>

<template>
  <section v-if="cities.length" class="city-map" aria-label="目标城市地图">
    <header><h3>城市舆图</h3><label>城市<select v-model="city" aria-label="地图城市"><option v-for="name in cities" :key="name">{{ name }}</option></select></label><label>路线<select v-model="selectedDay" aria-label="地图每日路线"><option value="all">城市总览</option><option v-for="entry in days" :key="entry.index" :value="String(entry.index)">第 {{ entry.index + 1 }} 日 · {{ entry.day.date || '日期待定' }}</option></select></label></header>
    <div class="city-map__frame"><CachedImage v-if="url" :src="url" :alt="`${city} ${selectedDay === 'all' ? '城市总览' : '当日地点顺序示意'}`" /><p v-else>尚无可信坐标，等待地点定位。文字行程和编辑可继续使用。</p></div>
    <p class="city-map__note">{{ located.length }} / {{ spots.length }} 处已定位。{{ selectedDay === 'all' ? '总览最多展示前 10 处地点，不绘制跨日连线。' : '标记及连线表示当日游览顺序，最多显示前 10 处；不是道路导航，不提供道路里程或用时。' }} 坐标系 BD-09。</p>
    <p v-if="locationSources.length" class="city-map__sources">地点来源：<a v-for="source in locationSources" :key="source.provider" :href="source.sourceUrl" target="_blank" rel="noopener noreferrer">{{ source.provider }}</a></p>
  </section>
</template>

<style scoped>
.city-map { overflow: hidden; border: 1px solid var(--border-primary); border-radius: 6px; background: var(--bg-card); }
.city-map header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 13px; }
.city-map h3 { font-size: 16px; font-weight: 500; margin: 0 auto 0 0; }
.city-map label { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; }
.city-map select { max-width: 200px; border: 1px solid var(--border-primary); border-radius: 3px; padding: 4px; background: var(--bg-card); color: var(--text-primary); }
.city-map__frame { height: 300px; background: var(--bg-card-muted); }
.city-map__frame :deep(.cached-image) { object-fit: contain; }
.city-map__frame > p { display: grid; place-items: center; padding: 22px; margin: 0; height: 100%; color: var(--text-muted); font-size: 12px; text-align: center; }
.city-map__note, .city-map__sources { padding: 0 13px; font-size: 10px; color: var(--text-muted); line-height: 1.8; }
.city-map__sources a { color: var(--bamboo); margin-right: 8px; }
</style>

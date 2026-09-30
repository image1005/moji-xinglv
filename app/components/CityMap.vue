<script setup lang="ts">
import type { Plan } from '#shared/schemas/plan'
import type { PlanResource } from '#shared/schemas/media'
import { cityMapPlaces } from '#shared/utils/city-map'
import { hasCoordinates } from '#shared/utils/routes'

const props = defineProps<{ plan: Plan; resources: PlanResource[] }>()
const city = ref('')
const selectedDay = ref('all')
const selectedKey = ref('')
const interactiveReady = ref(false)
const mapView = ref<{ focusPlace: (key: string) => void } | null>(null)
function selectPlace(key: string) {
  if (selectedKey.value === key) mapView.value?.focusPlace(key)
  selectedKey.value = key
}
const cities = computed(() => [...new Set(props.plan.days.map(day => day.city.trim()).filter(Boolean))])
const days = computed(() => props.plan.days.map((day, index) => ({ day, index })).filter(({ day }) => day.city.trim() === city.value))
watch(cities, values => { if (!values.includes(city.value)) city.value = values[0] ?? '' }, { immediate: true })
watch(city, () => { selectedDay.value = 'all' })
watch(days, values => { if (selectedDay.value !== 'all' && !values.some(({ index }) => String(index) === selectedDay.value)) selectedDay.value = 'all' })
const places = computed(() => cityMapPlaces(props.plan, props.resources, city.value, selectedDay.value === 'all' ? null : Number(selectedDay.value)))
const located = computed(() => places.value.filter(hasCoordinates))
const center = computed(() => {
  const location = props.resources.find(item => item.entityType === 'city' && item.city.trim() === city.value)?.location
  return location && hasCoordinates(location) ? location : null
})
const scopeKey = computed(() => `${city.value}:${selectedDay.value}`)
const selection = computed(() => places.value.find(place => place.key === selectedKey.value))
watch(scopeKey, () => { selectedKey.value = '' })
watch(places, values => { if (!values.some(place => place.key === selectedKey.value)) selectedKey.value = '' })
// The fallback is deliberately labelled as a static preview. Interactive markers are rendered as DOM text.
const fallbackUrl = computed(() => {
  const point = center.value ?? located.value[0]
  if (!point) return ''
  const params = new URLSearchParams({ center: `${point.lng},${point.lat}`, zoom: '12', width: '800', height: '480', scale: '1' })
  const preview = located.value.slice(0, 10)
  for (const place of preview) params.append('markers', `${place.lng},${place.lat}`)
  if (preview.length) params.set('markerStyles', preview.map(place => `l,${place.spotIndex < 9 ? place.label : String.fromCharCode(65 + (place.spotIndex - 9) % 26)},0xA63A2F`).join('|'))
  return `/api/staticmap?${params}`
})
const locationSources = computed(() => [...new Map(props.resources.filter(item => item.city.trim() === city.value && item.location).map(item => [item.location!.provider, item.location!])).values()])
const dayColor = (index: number) => ['#a63a2f', '#34695c', '#795b24', '#485e8b'][index % 4]
</script>

<template>
  <section v-if="cities.length" class="city-map" aria-label="目标城市地图">
    <header class="city-map__heading"><div><span class="city-map__eyebrow">循迹山海</span><h3>城市舆图</h3></div><div class="city-map__filters"><label>城市<select v-model="city" aria-label="地图城市"><option v-for="name in cities" :key="name">{{ name }}</option></select></label><label>路线<select v-model="selectedDay" aria-label="地图每日路线"><option value="all">城市总览</option><option v-for="entry in days" :key="entry.index" :value="String(entry.index)">第 {{ entry.index + 1 }} 日 · {{ entry.day.date || '日期待定' }}</option></select></label></div></header>
    <div class="city-map__body">
      <InteractiveCityMap v-if="located.length || center" ref="mapView" :places="places" :center="center" :selected-key="selectedKey" :scope-key="scopeKey" :draw-route="selectedDay !== 'all'" :fallback-url="fallbackUrl" @select="selectPlace" @availability="interactiveReady = $event" />
      <div v-else class="city-map__empty"><strong>地点尚待定位</strong><p>尚无可信坐标，等待地点定位。文字行程和编辑可继续使用。</p></div>
      <aside class="city-map__itinerary" aria-label="地图地点清单">
        <header><strong>{{ selectedDay === 'all' ? '城市足迹' : '当日行程' }}</strong><span>{{ located.length }} / {{ places.length }} 处已定位</span></header>
        <ol v-if="places.length"><li v-for="place in places" :key="place.key"><button type="button" class="city-map__place" :class="{ 'is-selected': selectedKey === place.key, 'is-unlocated': !hasCoordinates(place) }" :aria-pressed="selectedKey === place.key" @click="selectPlace(place.key)"><span class="city-map__number" :style="{ '--day-color': dayColor(place.dayIndex) }">{{ place.label }}</span><span class="city-map__place-copy"><strong>{{ place.name }}</strong><small>第 {{ place.dayIndex + 1 }} 日<span v-if="place.time"> · {{ place.time }}</span><span v-if="!hasCoordinates(place)"> · 待定位</span></small></span></button></li></ol>
        <p v-else class="city-map__list-empty">添加地点后，在这里查看游览顺序。</p>
        <div v-if="selection" class="city-map__selection" aria-live="polite"><strong>{{ selection.name }}</strong><p>{{ selection.address || '暂无详细地址' }}</p><small>{{ hasCoordinates(selection) ? interactiveReady ? '已选中此地点，点击清单可再次聚焦。' : '此地点已定位，交互地图可用后可点击聚焦。' : '此地点尚无可信坐标，暂不能在地图中显示。' }}</small></div>
      </aside>
    </div>
    <p class="city-map__note">编号对应每天的行程顺序，清单保留全部地点。<template v-if="interactiveReady">颜色区分日期，相邻标记可点击展开。{{ selectedDay === 'all' ? '城市总览展示全部已定位地点，不绘制跨日连线。' : '虚线仅表示游览顺序，缺少坐标处断开；不代表道路导航或实际里程。' }}</template> 坐标系 BD-09。</p>
    <p v-if="locationSources.length" class="city-map__sources">地点来源：<a v-for="source in locationSources" :key="source.provider" :href="source.sourceUrl" target="_blank" rel="noopener noreferrer">{{ source.provider }}</a></p>
  </section>
</template>

<style scoped>
.city-map { overflow: hidden; min-width: 0; border: 1px solid var(--border-primary); border-radius: 6px; background: var(--bg-card); }
.city-map__heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; padding: 18px 20px; border-bottom: 1px solid var(--border-primary); }
.city-map__eyebrow { color: var(--gold, #97773f); font-size: 10px; letter-spacing: .16em; }
.city-map h3 { font-size: 21px; font-weight: 500; margin: 5px 0 0; }
.city-map__filters { display: flex; flex-wrap: wrap; gap: 12px; }
.city-map label { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; }
.city-map select { max-width: 210px; min-height: 34px; border: 1px solid var(--border-primary); border-radius: 3px; padding: 5px 8px; background: var(--bg-card); color: var(--text-primary); }
.city-map__body { display: grid; grid-template-columns: minmax(0, 1fr) 235px; }
.city-map__itinerary { display: flex; flex-direction: column; min-width: 0; max-height: 480px; border-left: 1px solid var(--border-primary); }
.city-map__itinerary > header { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 16px 13px; }
.city-map__itinerary > header strong { font-size: 13px; font-weight: 500; }.city-map__itinerary > header span { font-size: 10px; color: var(--text-muted); }
.city-map__itinerary ol { padding: 0 8px; margin: 0; list-style: none; overflow-y: auto; flex: 1; min-height: 80px; }
.city-map__place { display: flex; gap: 10px; align-items: center; width: 100%; border: 1px solid transparent; border-radius: 4px; background: transparent; text-align: left; padding: 12px 7px; cursor: pointer; color: var(--text-primary); }
.city-map__place:hover, .city-map__place.is-selected { border-color: #d8c5a1; background: #f6f0e3; }
.city-map__place:focus-visible, .city-map select:focus-visible { outline: 2px solid var(--bamboo); outline-offset: -2px; }
.city-map__number { display: grid; place-items: center; width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%; color: #fff; background: var(--day-color); font: 600 13px system-ui, sans-serif; }
.city-map__place.is-unlocated .city-map__number { color: #776f61; background: #eae5d9; }
.city-map__place-copy { display: grid; gap: 5px; min-width: 0; overflow-wrap: anywhere; }.city-map__place-copy strong { font-size: 13px; font-weight: 500; line-height: 1.5; }.city-map__place-copy small { font-size: 10px; color: var(--text-muted); }
.city-map__selection { border-top: 1px solid var(--border-primary); padding: 13px; background: var(--bg-card-muted); }.city-map__selection strong { font-size: 13px; }.city-map__selection p { margin: 7px 0; line-height: 1.7; font-size: 11px; color: var(--text-secondary); overflow-wrap: anywhere; }.city-map__selection small { font-size: 10px; color: var(--text-muted); }
.city-map__empty { display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 300px; padding: 30px; text-align: center; background: var(--bg-card-muted); color: var(--text-muted); }.city-map__empty strong { font-size: 18px; font-weight: 500; }.city-map__empty p, .city-map__list-empty { font-size: 12px; line-height: 1.8; }.city-map__list-empty { padding: 16px; color: var(--text-muted); }
.city-map__note, .city-map__sources { padding: 0 20px; font-size: 11px; color: var(--text-muted); line-height: 1.8; }
.city-map__sources a { color: var(--bamboo); margin-right: 8px; }
@media (max-width: 900px) { .city-map__body { grid-template-columns: minmax(0, 1fr); }.city-map__itinerary { border-left: 0; border-top: 1px solid var(--border-primary); max-height: 285px; }.city-map__itinerary ol { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }.city-map__heading { padding: 16px; } }
@media (max-width: 500px) { .city-map__filters { width: 100%; }.city-map label { min-width: 0; flex: 1; }.city-map select { min-width: 0; max-width: 100%; flex: 1; }.city-map__itinerary ol { grid-template-columns: minmax(0, 1fr); }.city-map__note, .city-map__sources { padding: 0 16px; } }
</style>

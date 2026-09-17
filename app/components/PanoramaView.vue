<script setup lang="ts">
import { api } from '~/utils/api'
import { hasCoordinates } from '#shared/utils/routes'

const currentPlan = useBoundPlan()

const spots = computed(() => currentPlan.value?.plan.days.flatMap((d) => d.spots) ?? [])
const index = ref(0)
const heading = ref(0)
const fov = ref(90)
const committedHeading = ref(0)
const committedFov = ref(90)
let timer: ReturnType<typeof setTimeout> | undefined
let active = true
function commitAngle() {
  clearTimeout(timer)
  if (!active) return
  committedHeading.value = heading.value
  committedFov.value = fov.value
}
watch([heading, fov], () => { clearTimeout(timer); if (active) timer = setTimeout(commitAngle, 250) })
onDeactivated(() => { active = false; clearTimeout(timer) })
onActivated(() => { active = true; commitAngle() })
onBeforeUnmount(() => clearTimeout(timer))

const spot = computed(() => spots.value[index.value] ?? null)

const url = computed(() => {
  if (!spot.value || !hasCoordinates(spot.value)) return ''
  return api.panoramaUrl({
    location: `${spot.value.lng},${spot.value.lat}`,
    heading: committedHeading.value,
    fov: committedFov.value,
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
watch(() => spots.value.length, (length) => {
  index.value = Math.min(index.value, Math.max(0, length - 1))
})
watch(index, () => {
  heading.value = 0
  fov.value = 90
  commitAngle()
})
</script>

<template>
  <div class="panorama-view">
    <div v-if="!spots.length" class="panorama-view__empty">行程中还没有地点。可在地图页手动添加，或在对话中开始规划。</div>
    <template v-else>
      <label class="panorama-view__select">
        景点
        <select v-model.number="index">
          <option v-for="(item, i) in spots" :key="i" :value="i">
            {{ item.name }}{{ hasCoordinates(item) ? '' : ' · 坐标待补全' }}
          </option>
        </select>
      </label>
      <div class="panorama-view__frame">
        <CachedImage v-if="url" :src="url" :alt="`${spot?.name} 街景`" />
        <div v-else class="panorama-view__coordinate-empty">坐标待补全，暂无法查看街景。<br>在地图页补充此地点的 BD-09 经纬度即可。</div>
      </div>
      <p v-if="spot?.notes" class="panorama-view__notes">{{ spot.notes }}</p>
      <div class="panorama-view__sliders">
        <label>
          视角 {{ heading }}°
          <input v-model.number="heading" type="range" min="0" max="360" step="5" :disabled="!url" @change="commitAngle" >
        </label>
        <label>
          视野 {{ fov }}°
          <input v-model.number="fov" type="range" min="20" max="180" step="5" :disabled="!url" @change="commitAngle" >
        </label>
      </div>
      <p class="panorama-view__note">
        拖动滑块调整视角，停下后更新画面。图像覆盖和拍摄时间由服务提供方决定，暂缺图像不影响编辑行程。
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
.panorama-view__coordinate-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  box-sizing: border-box;
  font-size: 13px;
  line-height: 1.9;
  color: var(--ink-faint);
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

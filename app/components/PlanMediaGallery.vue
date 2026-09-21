<script setup lang="ts">
import type { Plan } from '#shared/schemas/plan'
const props = defineProps<{ planId: number; revision: number; plan: Plan; compact?: boolean; only?: 'food' | 'spot' }>()
const { planResources, currentPlan } = useWorkspace()
const limit = ref(props.compact ? 6 : 12)
const record = computed(() => planResources.records.value[props.planId])
const resources = computed(() => record.value?.revision === props.revision ? record.value.resources : [])
const media = computed(() => resources.value.filter(item => item.entityType !== 'city' && (!props.only || item.entityType === props.only)))
const active = computed(() => planResources.active.value[props.planId] ?? [])
const failure = computed(() => planResources.failures.value[props.planId])
const pending = computed(() => resources.value.some(item => item.status === 'pending'))
const samePlan = computed(() => currentPlan.value?.id === props.planId && currentPlan.value.revision === props.revision)
watch(() => [props.planId, props.revision, samePlan.value], () => { if (import.meta.client && samePlan.value) void planResources.load(props.planId, props.revision) }, { immediate: true })
onMounted(() => { if (samePlan.value) void planResources.load(props.planId, props.revision) })
function retry(entityId?: string) { if (samePlan.value) void planResources.enrich(props.planId, props.revision, entityId) }
</script>

<template>
  <section class="plan-media" aria-label="景点美食图片与地图">
    <header><h3>{{ only === 'food' ? '食记图鉴' : '沿途图鉴' }}</h3><span>{{ active.length ? '图片与地点逐步补齐中…' : '图片与定位独立于行程版本保存' }}</span></header>
    <p v-if="failure" class="feedback" role="alert">{{ failure }} <button class="btn btn--small" :disabled="!samePlan || !!active.length" @click="planResources.load(planId, revision, true)">重新加载</button></p>
    <div v-if="media.length" class="plan-media__grid">
      <PlanResourceImage v-for="item in media.slice(0, limit)" :key="item.entityId" :resource="item" :label="item.name" :busy="active.includes(item.entityId)" :disabled="!!active.length || !samePlan" @retry="retry(item.entityId)" />
    </div>
    <p v-else class="plan-media__empty">{{ record ? '添加景点或美食后，可取得对应图片和地点资料。' : '行程已就绪，正在读取图片与地点资料…' }}</p>
    <div class="plan-media__actions"><button v-if="media.length > limit" class="btn btn--small" @click="limit += 12">展开更多图片</button><button v-if="pending && !active.length" class="btn btn--small" :disabled="!samePlan" @click="retry()">继续补充图片与地点</button></div>
    <CityMap v-if="!only" :plan="plan" :resources="resources" />
  </section>
</template>

<style scoped>
.plan-media { display: grid; gap: 13px; min-width: 0; }
.plan-media header { display: flex; gap: 12px; flex-wrap: wrap; align-items: baseline; }
.plan-media h3 { margin: 0; font-size: 18px; font-weight: 500; }
.plan-media header > span, .plan-media__empty { font-size: 11px; color: var(--text-muted); line-height: 1.7; }
.plan-media__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(155px, 1fr)); gap: 10px; }
.plan-media__actions { display: flex; gap: 10px; }
</style>

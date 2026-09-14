<script setup lang="ts">
const { currentPlan } = useWorkspace()

const tabs = [
  { key: 'detail', label: '行程' },
  { key: 'map', label: '地图' },
  { key: 'panorama', label: '街景' },
  { key: 'json', label: 'JSON' },
  { key: 'agents', label: 'AGENTS.md' },
] as const

const tab = ref<(typeof tabs)[number]['key']>('detail')

watch(
  () => currentPlan.value?.id,
  () => {
    tab.value = 'detail'
  },
)
</script>

<template>
  <div class="plan-view">
    <nav class="plan-view__tabs">
      <button
        v-for="item in tabs"
        :key="item.key"
        class="plan-view__tab"
        :class="{ 'plan-view__tab--active': tab === item.key }"
        @click="tab = item.key"
      >
        {{ item.label }}
      </button>
    </nav>
    <div class="plan-view__body">
      <p v-if="!currentPlan" class="plan-view__empty">选择左侧工作区的「规划预览与编辑」后在此查看。</p>
      <template v-else>
        <ItineraryView v-if="tab === 'detail'" />
        <MapView v-else-if="tab === 'map'" />
        <PanoramaView v-else-if="tab === 'panorama'" />
        <JsonViewer v-else-if="tab === 'json'" />
        <AgentsPanel v-else />
      </template>
    </div>
  </div>
</template>

<style scoped>
.plan-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.plan-view__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 18px;
  height: 40px;
  border-bottom: 1px solid var(--line-soft);
  flex-shrink: 0;
}
.plan-view__tab {
  border: none;
  background: none;
  padding: 8px 10px;
  font-size: 14px;
  font-family: inherit;
  color: var(--ink-faint);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.plan-view__tab--active {
  color: var(--cinnabar);
  border-bottom-color: var(--cinnabar);
}
.plan-view__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px 24px;
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
}
.plan-view__empty {
  margin: 18vh auto 0;
  text-align: center;
  font-size: 13px;
  color: var(--ink-faint);
}
</style>

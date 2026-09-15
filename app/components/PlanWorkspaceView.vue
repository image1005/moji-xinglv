<script setup lang="ts">
const { currentPlan, mainMode } = useWorkspace()
const tabs = [
  { key: 'detail', label: '行程总览', icon: 'book' },
  { key: 'map', label: '路线舆图', icon: 'compass' },
  { key: 'food', label: '风物食记', icon: 'bowl' },
  { key: 'panorama', label: '沿途街景', icon: 'mountain' },
  { key: 'agents', label: '旅行偏好', icon: 'leaf' },
] as const
type TabKey = (typeof tabs)[number]['key']
const selectedTabs = reactive<Record<number, TabKey>>({})
const tab = computed({
  get: () => currentPlan.value ? selectedTabs[currentPlan.value.id] ?? 'detail' : 'detail',
  set: (value: TabKey) => { if (currentPlan.value) selectedTabs[currentPlan.value.id] = value },
})
const viewKey = computed(() => `${currentPlan.value?.id ?? 'empty'}:${tab.value}`)
</script>

<template>
  <section class="plan-view">
    <nav class="plan-view__tabs" aria-label="行笺内容" role="tablist">
      <button v-for="item in tabs" :key="item.key" class="plan-view__tab" :class="{ 'plan-view__tab--active': tab === item.key }" role="tab" :aria-selected="tab === item.key" :disabled="!currentPlan" @click="tab = item.key"><AppIcon :name="item.icon" :size="15" />{{ item.label }}</button>
    </nav>
    <div class="plan-view__body">
      <div v-if="!currentPlan" class="empty-state"><p class="eyebrow">行笺待启</p><h3>将向往，写成行程。</h3><p>在左侧选择一份行笺，或和 AI 聊聊你想去的地方。</p><button class="btn btn--seal" @click="mainMode = 'chat'">开始旅途对话<AppIcon name="arrow" :size="14" /></button></div>
      <KeepAlive :max="36">
        <ItineraryView v-if="currentPlan && tab === 'detail'" :key="viewKey" />
        <MapView v-else-if="currentPlan && tab === 'map'" :key="viewKey" />
        <FoodJournalView v-else-if="currentPlan && tab === 'food'" :key="viewKey" />
        <PanoramaView v-else-if="currentPlan && tab === 'panorama'" :key="viewKey" />
        <AgentsPanel v-else-if="currentPlan" :key="viewKey" />
      </KeepAlive>
    </div>
  </section>
</template>

<style scoped>
.plan-view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.plan-view__tabs { display: flex; align-items: center; gap: 25px; padding: 0 34px; min-height: 56px; border-bottom: 1px solid var(--line-soft); flex-shrink: 0; overflow-x: auto; }
.plan-view__tab { display: flex; align-items: center; gap: 7px; align-self: stretch; flex-shrink: 0; border: none; border-bottom: 2px solid transparent; background: none; padding: 16px 0; font-size: 12px; color: var(--ink-faint); cursor: pointer; white-space: nowrap; }
.plan-view__tab:hover { color: var(--ink); }
.plan-view__tab--active { color: var(--cinnabar); border-bottom-color: var(--cinnabar); }
.plan-view__tab:disabled { opacity: 0.45; }
.plan-view__body { flex: 1; min-height: 0; overflow-y: auto; padding: 34px 40px 48px; width: 100%; max-width: 1180px; margin: 0 auto; }
.plan-view__body > .empty-state { margin-top: 8vh; }
@media (max-width: 1200px) { .plan-view__tabs { gap: 20px; } .plan-view__body { padding: 28px; } }
@media (max-width: 640px) { .plan-view__tabs { gap: 22px; padding: 0 20px; min-height: 51px; } .plan-view__tab { font-size: 11px; padding: 14px 0; } .plan-view__body { padding: 23px 18px 36px; } }
</style>

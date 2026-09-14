<script setup lang="ts">
const {
  mainMode,
  currentPlan,
  currentConversationId,
  conversations,
  uiLeftOpen,
  openWorkspace,
  openPlanView,
} = useWorkspace()

const conversation = computed(
  () => conversations.value.find((c) => c.id === currentConversationId.value) ?? null,
)

const title = computed(() => {
  if (mainMode.value === 'settings') return '设置'
  if (mainMode.value === 'plan') return currentPlan.value?.title ?? '规划'
  return conversation.value?.title ?? '新对话'
})

function backToChat() {
  if (currentPlan.value) void openWorkspace(currentPlan.value.id)
}
</script>

<template>
  <section class="main">
    <header class="main__bar">
      <button class="main__menu" title="工作区" @click="uiLeftOpen = !uiLeftOpen">
        <AppIcon name="menu" :size="16" />
      </button>
      <div class="main__title">
        <h2>{{ title }}</h2>
        <span v-if="mainMode === 'chat' && currentPlan" class="main__badge">{{ currentPlan.title }}</span>
        <span v-if="mainMode === 'plan' && currentPlan" class="main__badge">工作区 · v{{ currentPlan.version }}</span>
      </div>
      <div class="main__actions">
        <button
          v-if="mainMode === 'chat' && currentPlan"
          class="btn btn--ghost btn--small"
          @click="openPlanView()"
        >
          规划预览
        </button>
        <button v-else-if="mainMode === 'plan'" class="btn btn--ghost btn--small" @click="backToChat">
          <AppIcon name="back" :size="13" />
          返回对话
        </button>
      </div>
    </header>
    <div class="main__body">
      <ConversationView v-if="mainMode === 'chat'" />
      <PlanWorkspaceView v-else-if="mainMode === 'plan'" />
      <SettingsView v-else />
    </div>
  </section>
</template>

<style scoped>
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--paper);
}
.main__bar {
  height: var(--topbar-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  background: var(--paper-deep);
}
.main__menu {
  display: none;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--ink-soft);
  cursor: pointer;
  padding: 4px;
}
.main__title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.main__title h2 {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 16px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.main__badge {
  font-size: 11px;
  color: var(--gold-deep);
  border: 1px solid var(--gold);
  border-radius: 3px;
  padding: 1px 7px;
  white-space: nowrap;
}
.main__actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.main__actions .btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.main__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
@media (max-width: 960px) {
  .main__menu {
    display: flex;
  }
}
</style>

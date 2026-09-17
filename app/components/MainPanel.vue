<script setup lang="ts">
const {
  mainMode, currentPlan, currentConversationId, conversations, uiLeftOpen, loading, chat, stop, offline, refreshCurrentPlan,
} = useWorkspace()
const generating = computed(() => chat.value?.status === 'streaming' || chat.value?.status === 'submitted')
const conversation = computed(() => conversations.value.find((c) => c.id === currentConversationId.value) ?? null)
const title = computed(() => {
  if (mainMode.value === 'settings') return '偏好与设置'
  if (mainMode.value === 'plan') return currentPlan.value?.title ?? '行程总览'
  return conversation.value?.title ?? '开启一段山海之旅'
})
</script>

<template>
  <section id="main-content" class="main" aria-label="行笺工作台">
    <header class="main__bar">
      <button class="main__menu" title="打开行笺导航" aria-label="打开行笺导航" :aria-expanded="uiLeftOpen" @click="uiLeftOpen = !uiLeftOpen"><AppIcon name="menu" :size="19" /></button>
      <div class="main__heading">
        <nav class="main__breadcrumb" aria-label="当前位置"><span>山海行笺</span><AppIcon name="chevron" :size="9" /><span>{{ mainMode === 'settings' ? '个人空间' : mainMode === 'plan' ? '我的行程' : '灵感与对话' }}</span></nav>
        <div class="main__title"><h2>{{ title }}</h2><span v-if="mainMode === 'plan' && currentPlan" class="main__badge">v{{ currentPlan.version }}</span></div>
      </div>
      <div class="main__actions">
        <button v-if="generating" class="btn btn--small" @click="stop">正在生成 · 停止</button>
        <span v-if="loading" class="main__status" role="status">正在整理行笺…</span>
        <span v-else-if="mainMode === 'chat'" class="main__status"><span />你的 AI 旅行知己</span>
      </div>
    </header>
    <div v-if="offline" class="feedback" role="status">当前显示最近保存的离线快照，编辑草稿会保留。<button class="btn btn--small" @click="refreshCurrentPlan">重新连接</button></div>
    <div class="main__body" :aria-busy="loading">
      <KeepAlive :max="3">
        <ConversationView v-if="mainMode === 'chat'" key="chat" />
        <LazyPlanWorkspaceView v-else-if="mainMode === 'plan'" key="plan" />
        <LazySettingsView v-else key="settings" />
      </KeepAlive>
    </div>
  </section>
</template>

<style scoped>
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--paper); }
.main__bar { min-height: var(--topbar-height); flex-shrink: 0; display: flex; align-items: center; gap: 15px; padding: 16px 34px; border-bottom: 1px solid var(--line-soft); background: var(--paper); }
.main__menu { display: none; align-items: center; justify-content: center; border: 1px solid var(--line); border-radius: 5px; background: var(--paper-white); color: var(--ink-soft); cursor: pointer; width: 34px; height: 34px; padding: 0; flex-shrink: 0; }
.main__heading { min-width: 0; }
.main__breadcrumb { display: flex; align-items: center; gap: 9px; margin-bottom: 7px; color: var(--ink-faint); font-size: 10px; letter-spacing: 0.07em; }
.main__breadcrumb > span:first-child { color: var(--gold-deep); }
.main__title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.main__title h2 { margin: 0; font-family: var(--font-body); font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.main__badge { font-size: 10px; color: var(--gold-deep); border: 1px solid #e2d6bf; border-radius: 3px; padding: 1px 6px; white-space: nowrap; }
.main__actions { margin-left: auto; display: flex; align-items: center; gap: 22px; flex-shrink: 0; }
.main__status { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--ink-faint); letter-spacing: 0.03em; }
.main__status > span { width: 5px; height: 5px; border-radius: 50%; background: var(--bamboo); }
.main__body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
@media (max-width: 1100px) { .main__status { display: none; } }
@media (max-width: 960px) { .main__menu { display: flex; } .main__bar { padding: 13px 20px; } }
@media (max-width: 520px) { .main__bar { gap: 10px; padding: 12px 14px; } .main__actions { gap: 6px; } .main__actions .btn { padding: 6px 9px; font-size: 11px; } .main__breadcrumb { font-size: 9px; } }
</style>

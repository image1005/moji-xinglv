<script setup lang="ts">
const {
  mainMode, currentPlan, currentConversationId, conversations, uiLeftOpen, loading, chat, stop, offline, refreshCurrentPlan,
} = useWorkspace()
const { currentTheme, toggleTheme } = useAppTheme()
const isSidebarCollapsed = useState('sidebar-collapsed', () => false)
const mobile = useState('workspace-mobile', () => false)

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
      <!-- 移动端抽屉唤醒按钮 -->
      <button class="main__menu" title="打开行笺导航" aria-label="打开行笺导航" :aria-expanded="uiLeftOpen" @click="uiLeftOpen = !uiLeftOpen">
        <AppIcon name="menu" :size="19" />
      </button>

      <!-- 桌面端侧边栏展开按钮（仅折叠时出现） -->
      <button
        v-if="isSidebarCollapsed && !mobile"
        type="button"
        class="main__uncollapse-btn"
        title="展开侧边栏"
        aria-label="展开侧边栏"
        @click="isSidebarCollapsed = false"
      >
        <AppIcon name="sidebar" :size="16" />
      </button>

      <div class="main__heading">
        <nav class="main__breadcrumb" aria-label="当前位置">
          <span>山海行笺</span>
          <AppIcon name="chevron" :size="9" />
          <span>{{ mainMode === 'settings' ? '个人空间' : mainMode === 'plan' ? '我的行程' : '灵感与对话' }}</span>
        </nav>
        <div class="main__title">
          <h2>{{ title }}</h2>
          <span v-if="mainMode === 'plan' && currentPlan" class="main__badge">v{{ currentPlan.version }}</span>
        </div>
      </div>

      <div class="main__actions">
        <button
          class="btn-theme-quick"
          :title="currentTheme === 'dark' ? '切换至素笺宣墨 (明色)' : '切换至玄青夜墨 (暗色)'"
          :aria-label="currentTheme === 'dark' ? '切换至素笺宣墨 (明色)' : '切换至玄青夜墨 (暗色)'"
          @click="toggleTheme"
        >
          <AppIcon :name="currentTheme === 'dark' ? 'sun' : 'moon'" :size="15" />
        </button>
        <button v-if="generating" class="btn btn--small btn--seal" @click="stop">正在生成 · 停止</button>
        <span v-if="loading" class="main__status" role="status">正在整理行笺…</span>
      </div>
    </header>

    <div v-if="offline" class="feedback" role="status">
      当前显示最近保存的离线快照，编辑草稿会保留。
      <button class="btn btn--small" @click="refreshCurrentPlan">重新连接</button>
    </div>

    <div class="main__body" :aria-busy="loading">
      <KeepAlive :max="3">
        <ConversationView v-if="mainMode === 'chat'" key="chat" />
        <LazyPlanWorkspaceView v-else-if="mainMode === 'plan'" key="plan" />
        <LazySettingsView v-else key="settings" />
      </KeepAlive>
    </div>
  </section>
</template>

<style lang="scss" scoped>
@use "~/assets/styles/variables" as *;

.main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg-page); }
.main__bar {
  min-height: var(--topbar-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 16px 34px;
  border-bottom: 1px solid var(--border-secondary);
  background: var(--bg-page);
  transition: background-color $dur-base $ease-soft, border-color $dur-base $ease-soft;
}
.main__menu {
  display: none;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  width: 34px;
  height: 34px;
  padding: 0;
  flex-shrink: 0;
  box-shadow: var(--shadow-sm);
  transition: all $dur-fast $ease-soft;

  &:hover {
    color: var(--cinnabar);
    border-color: var(--border-hover);
  }
}

.main__uncollapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  width: 32px;
  height: 32px;
  padding: 0;
  flex-shrink: 0;
  box-shadow: var(--shadow-sm);
  animation: slide-in-left $dur-base $ease-spring both;
  transition: all $dur-fast $ease-soft;

  &:hover {
    color: var(--cinnabar);
    border-color: var(--border-hover);
    transform: translateY(-1px);
    box-shadow: var(--shadow-card);
  }

  &:active {
    transform: scale(0.94);
  }
}

.main__heading { min-width: 0; }
.main__breadcrumb { display: flex; align-items: center; gap: 9px; margin-bottom: 5px; color: var(--text-muted); font-size: 11px; letter-spacing: 0.07em; }
.main__breadcrumb > span:first-child { color: var(--gold-deep); font-weight: 500; }
.main__title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.main__title h2 { margin: 0; font-family: var(--font-body); font-size: 14px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.main__badge { font-size: 10.5px; color: var(--gold-deep); border: 1px solid var(--border-secondary); background: var(--bg-card-muted); border-radius: 4px; padding: 1px 7px; white-space: nowrap; font-weight: 500; }
.main__actions { margin-left: auto; display: flex; align-items: center; gap: 16px; flex-shrink: 0; }

.btn-theme-quick {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  border: 1px solid var(--border-secondary);
  background: var(--bg-card);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all $dur-base $ease-soft;

  &:hover {
    color: var(--cinnabar);
    border-color: var(--border-hover);
    transform: translateY(-1px);
    box-shadow: var(--shadow-card);

    .app-icon {
      transform: rotate(180deg);
    }
  }

  &:active {
    transform: scale(0.94);
  }

  .app-icon {
    transition: transform $dur-slow $ease-spring;
  }
}

.main__status { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); letter-spacing: 0.03em; }
.main__status > span { width: 6px; height: 6px; border-radius: 50%; background: var(--bamboo); animation: breathe 1.5s ease-in-out infinite; }
.main__body { flex: 1; min-height: 0; display: flex; flex-direction: column; }

@media (max-width: 1100px) { .main__status { display: none; } }
@media (max-width: 960px) { .main__menu { display: flex; } .main__bar { padding: 13px 20px; } }
@media (max-width: 520px) { .main__bar { gap: 10px; padding: 12px 14px; } .main__actions { gap: 8px; } .main__actions .btn { padding: 6px 9px; font-size: 11px; } .main__breadcrumb { font-size: 9px; } }
</style>

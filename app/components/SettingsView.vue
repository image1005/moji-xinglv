<script setup lang="ts">
const { user, loadMe, clearUser } = useCurrentUser()
const { resetWorkspace } = useWorkspace()
const { currentTheme, applyTheme } = useAppTheme()

onMounted(() => void loadMe())

async function logout() {
  resetWorkspace()
  clearUser()
  await signOut()
  await navigateTo('/login')
}
</script>

<template>
  <div class="settings">
    <section class="settings__card">
      <h3>界面外观</h3>
      <p class="settings__hint">
        选择适合当前光线与心境的视觉主题，在清雅素笺与沉静夜墨之间自如流转。
      </p>
      <div class="theme-selector">
        <button
          class="theme-opt"
          :class="{ 'is-active': currentTheme === 'light' }"
          @click="applyTheme('light')"
        >
          <AppIcon name="sun" :size="16" />
          <span>素笺宣墨 (明色)</span>
        </button>
        <button
          class="theme-opt"
          :class="{ 'is-active': currentTheme === 'dark' }"
          @click="applyTheme('dark')"
        >
          <AppIcon name="moon" :size="16" />
          <span>玄青夜墨 (暗色)</span>
        </button>
      </div>
    </section>

    <section class="settings__card">
      <h3>账号</h3>
      <p class="settings__line"><span>昵称</span>{{ user?.name || '—' }}</p>
      <p class="settings__line"><span>邮箱</span>{{ user?.email || '—' }}</p>
      <p class="settings__line"><span>角色</span>{{ user?.role === 'admin' ? '管理员' : '普通用户' }}</p>
      <div class="settings__actions">
        <NuxtLink v-if="user?.role === 'admin'" to="/admin" class="btn btn--ghost btn--small">
          后台管理
        </NuxtLink>
        <button class="btn btn--ghost btn--small" @click="logout">退出登录</button>
      </div>
    </section>

    <section class="settings__card">
      <h3>全局 AGENTS.md 偏好</h3>
      <p class="settings__hint">
        作用于你的所有工作区；单个工作区可在「规划预览与编辑 → 旅行偏好」中覆盖（优先级：工作区 &gt; 全局 &gt; 系统默认）。
      </p>
      <AgentsPanel fixed-scope="global" />
    </section>
  </div>
</template>

<style lang="scss" scoped>
@use "~/assets/styles/variables" as *;

.settings {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px;
  display: grid;
  gap: 18px;
  align-content: start;
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
  animation: rise-in $dur-slow $ease-ink both;
}

.settings__card {
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  background: var(--bg-card);
  padding: 18px 20px;
  box-shadow: var(--shadow-sm);
  transition: box-shadow $dur-fast $ease-soft, border-color $dur-fast $ease-soft;

  &:hover {
    box-shadow: var(--shadow-card);
  }
}

.settings__card h3 {
  margin: 0 0 10px;
  font-family: var(--font-serif);
  font-size: 16px;
  color: var(--text-primary);
  letter-spacing: 0.12em;
}

.settings__line {
  margin: 0 0 8px;
  font-size: 13.5px;
  color: var(--text-secondary);
  display: flex;
  gap: 14px;
}

.settings__line span {
  width: 48px;
  color: var(--text-muted);
}

.settings__hint {
  margin: 0 0 14px;
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.7;
}

.theme-selector {
  display: flex;
  gap: 12px;
  margin-bottom: 4px;
}

.theme-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 8px;
  border: 1px solid var(--border-primary);
  background: var(--bg-card-muted);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all $dur-base $ease-spring;

  &:hover {
    color: var(--text-primary);
    border-color: var(--border-hover);
    transform: translateY(-2px);
    box-shadow: var(--shadow-card);
  }

  &.is-active {
    border-color: var(--cinnabar);
    color: var(--cinnabar);
    background: var(--bg-card);
    font-weight: 600;
    box-shadow: 0 2px 10px var(--accent-red-subtle);
  }
}

.settings__actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
</style>

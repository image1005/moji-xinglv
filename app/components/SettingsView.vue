<script setup lang="ts">
const { user, loadMe, clearUser } = useCurrentUser()
const { resetWorkspace } = useWorkspace()

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
        作用于你的所有工作区；单个工作区可在「规划预览与编辑 → AGENTS.md」中覆盖（优先级：工作区 &gt; 全局 &gt; 系统默认）。
      </p>
      <AgentsPanel fixed-scope="global" />
    </section>
  </div>
</template>

<style scoped>
.settings {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
  display: grid;
  gap: 14px;
  align-content: start;
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
}
.settings__card {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper);
  padding: 14px 16px;
}
.settings__card h3 {
  margin: 0 0 10px;
  font-family: var(--font-serif);
  font-size: 15px;
  color: var(--ink);
  letter-spacing: 0.15em;
}
.settings__line {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--ink-soft);
  display: flex;
  gap: 12px;
}
.settings__line span {
  width: 48px;
  color: var(--ink-faint);
}
.settings__hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--ink-faint);
  line-height: 1.7;
}
.settings__actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
</style>

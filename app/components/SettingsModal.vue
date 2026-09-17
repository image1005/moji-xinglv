<script setup lang="ts">
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { user, loadMe, clearUser } = useCurrentUser()
const { resetWorkspace } = useWorkspace()
const { currentTheme, applyTheme } = useAppTheme()

watch(() => props.open, (isOpen) => {
  if (isOpen) void loadMe()
})

async function logout() {
  resetWorkspace()
  clearUser()
  emit('close')
  await signOut()
  await navigateTo('/login')
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

onMounted(() => {
  if (import.meta.client) window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  if (import.meta.client) window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="偏好与设置"
      @click="emit('close')"
    >
      <div class="modal-card" @click.stop>
        <div class="modal-header">
          <span class="modal-seal" aria-hidden="true">设</span>
          <h2 class="modal-title">偏好与设置</h2>
          <button
            type="button"
            class="modal-close"
            aria-label="关闭设置"
            @click="emit('close')"
          >
            <AppIcon name="close" :size="15" />
          </button>
        </div>

        <div class="modal-body">
          <!-- 1. 界面外观 -->
          <section class="settings-section">
            <h3 class="section-title">界面外观</h3>
            <p class="section-hint">选择适合当前光线与心境的视觉主题，在清雅素笺与沉静夜墨之间自如流转。</p>
            <div class="theme-selector">
              <button
                type="button"
                class="theme-opt"
                :class="{ 'is-active': currentTheme === 'light' }"
                @click="applyTheme('light')"
              >
                <AppIcon name="sun" :size="16" />
                <span>素笺宣墨 (明色)</span>
              </button>
              <button
                type="button"
                class="theme-opt"
                :class="{ 'is-active': currentTheme === 'dark' }"
                @click="applyTheme('dark')"
              >
                <AppIcon name="moon" :size="16" />
                <span>玄青夜墨 (暗色)</span>
              </button>
            </div>
          </section>

          <!-- 2. 账号信息 -->
          <section class="settings-section">
            <h3 class="section-title">账号信息</h3>
            <div class="account-grid">
              <div class="account-item">
                <span class="account-label">昵称</span>
                <span class="account-val">{{ user?.name || '—' }}</span>
              </div>
              <div class="account-item">
                <span class="account-label">邮箱</span>
                <span class="account-val">{{ user?.email || '—' }}</span>
              </div>
              <div class="account-item">
                <span class="account-label">角色</span>
                <span class="account-val account-badge">{{ user?.role === 'admin' ? '管理员' : '普通用户' }}</span>
              </div>
            </div>
            <div class="account-actions">
              <NuxtLink
                v-if="user?.role === 'admin'"
                to="/admin"
                class="btn btn--ghost btn--small"
                @click="emit('close')"
              >
                进入后台管理
              </NuxtLink>
              <button type="button" class="btn btn--ghost btn--small btn--danger-ghost" @click="logout">
                退出登录
              </button>
            </div>
          </section>

          <!-- 3. 全局偏好 -->
          <section class="settings-section">
            <h3 class="section-title">全局 AGENTS.md 偏好</h3>
            <p class="section-hint">
              作用于你的所有工作区；单个工作区可在「规划预览与编辑 → 旅行偏好」中覆盖。
            </p>
            <AgentsPanel fixed-scope="global" />
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
@use "~/assets/styles/variables" as *;

.modal-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: $z-modal;
  padding: 20px;
  animation: fade-in $dur-base $ease-soft both;
}

.modal-card {
  width: 100%;
  max-width: 660px;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 16px;
  box-shadow: var(--shadow-float);
  animation: modal-card-in $dur-slow $ease-ink both;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 24px;
  border-bottom: 1px solid var(--border-secondary);
  background-color: var(--bg-card);
  flex-shrink: 0;

  .modal-seal {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    background-color: var(--cinnabar);
    color: #ffffff;
    font-family: var(--font-serif);
    font-weight: 700;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 6px var(--accent-red-subtle);
  }

  .modal-title {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 17px;
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    letter-spacing: 0.05em;
  }

  .modal-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    padding: 6px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all $dur-fast $ease-soft;

    &:hover {
      color: var(--text-primary);
      background-color: var(--bg-sidebar-hover);
    }
  }
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 28px;
  display: grid;
  gap: 24px;
}

.settings-section {
  padding-bottom: 20px;
  border-bottom: 1px dashed var(--border-secondary);

  &:last-child {
    padding-bottom: 0;
    border-bottom: none;
  }

  .section-title {
    margin: 0 0 8px;
    font-family: var(--font-serif);
    font-size: 15px;
    color: var(--text-primary);
    letter-spacing: 0.05em;
  }

  .section-hint {
    margin: 0 0 14px;
    font-size: 12.5px;
    color: var(--text-muted);
    line-height: 1.65;
  }
}

.theme-selector {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;

  .theme-opt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 18px;
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
}

.account-grid {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;

  .account-item {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 13px;

    .account-label {
      width: 44px;
      color: var(--text-muted);
    }

    .account-val {
      color: var(--text-primary);
      font-weight: 500;
    }

    .account-badge {
      font-size: 11px;
      padding: 1px 7px;
      border-radius: 4px;
      background: var(--bg-card-muted);
      border: 1px solid var(--border-secondary);
      color: var(--gold-deep);
    }
  }
}

.account-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;

  .btn--danger-ghost:hover {
    color: var(--cinnabar);
    background-color: var(--cinnabar-soft);
  }
}
</style>

<script setup lang="ts">
import { apiErrorMessage } from '~/utils/api'

const {
  workspaces, currentPlan, currentConversationId, mainMode, keyword, uiLeftOpen,
  loading, loadingPlans, errorMessage, sortOrder, isExpanded, toggleExpanded, toggleSort, openWorkspace,
  openPlanView, newSession, createWorkspace, removePlan, removeConversation,
  plansHasMore, loadMorePlans, conversationsHasMore, loadMoreConversations,
  openConversation, isConversationsLoaded, loadConversations,
} = useWorkspace()
const { user } = useCurrentUser()
const isSidebarCollapsed = useState('sidebar-collapsed', () => false)
const isSettingsOpen = ref(false)
const searchOpen = ref(false)
const busy = ref(false)
const actionError = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const disabled = computed(() => loading.value || busy.value)
const nickname = computed(() => user.value?.name || user.value?.email?.split('@')[0] || '旅人')
const drawer = ref<HTMLElement | null>(null)
const mobile = useState('workspace-mobile', () => false)
let media: MediaQueryList | undefined
let returnFocus: HTMLElement | null = null
function updateMobile() { mobile.value = media?.matches ?? false }
onMounted(() => { media = window.matchMedia('(max-width: 960px)'); updateMobile(); media.addEventListener('change', updateMobile) })
onBeforeUnmount(() => media?.removeEventListener('change', updateMobile))
watch([uiLeftOpen, mobile], async ([open, compact]) => {
  if (open && compact) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    if (uiLeftOpen.value) drawer.value?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
  } else if (returnFocus) {
    const target = returnFocus
    returnFocus = null
    await nextTick()
    if (target.isConnected) target.focus()
  }
}, { flush: 'post' })
function onDrawerKeydown(event: KeyboardEvent) {
  if (!mobile.value || !uiLeftOpen.value) return
  if (event.key === 'Escape') { event.preventDefault(); uiLeftOpen.value = false; return }
  if (event.key !== 'Tab') return
  const elements = [...(drawer.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') ?? [])].filter((el) => el.getClientRects().length)
  const first = elements[0]
  const last = elements.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}

async function runAction(action: () => Promise<unknown>, closeDrawer = true) {
  if (disabled.value) return
  busy.value = true
  actionError.value = ''
  try {
    const result = await action()
    if (result === null) {
      actionError.value = errorMessage.value || '操作未完成，请重试。'
      return
    }
    if (closeDrawer) uiLeftOpen.value = false
  } catch (error) {
    actionError.value = apiErrorMessage(error, '操作未完成，请重试。')
  } finally {
    busy.value = false
  }
}

function toggleSearch() {
  searchOpen.value = !searchOpen.value
  if (!searchOpen.value) keyword.value = ''
  else void nextTick(() => searchInput.value?.focus())
}

function onCreateWorkspace() {
  void runAction(async () => {
    if (!await createWorkspace('未命名行笺')) return null
    return await newSession()
  })
}

function onNewConversation(planId: number) {
  void runAction(async () => {
    if (await openWorkspace(planId) === null) return null
    return await newSession()
  })
}

// 统一国风确认弹窗状态
const confirmModal = reactive({
  open: false,
  title: '',
  description: '',
  onConfirm: () => {},
})

function onRemovePlan(planId: number, title: string) {
  confirmModal.title = '删除行笺'
  confirmModal.description = `确定删除行笺「${title}」？其包含的全部旅途对话、行程安排与版本留痕将一并移除，此操作无法恢复。`
  confirmModal.onConfirm = () => {
    confirmModal.open = false
    void runAction(() => removePlan(planId), false)
  }
  confirmModal.open = true
}

function onRemoveConversation(id: number, title?: string) {
  confirmModal.title = '删除旅途对话'
  confirmModal.description = `确定删除对话${title ? `「${title}」` : ''}及其全部消息记录？此操作无法恢复。`
  confirmModal.onConfirm = () => {
    confirmModal.open = false
    void runAction(() => removeConversation(id), false)
  }
  confirmModal.open = true
}

function showSettings() {
  isSettingsOpen.value = true
}
</script>

<template>
  <aside
    ref="drawer"
    class="ws"
    :class="{ 'ws--open': uiLeftOpen, 'ws--collapsed': isSidebarCollapsed && !mobile }"
    :inert="mobile && !uiLeftOpen"
    :aria-hidden="mobile && !uiLeftOpen ? true : undefined"
    :role="mobile ? 'dialog' : undefined"
    :aria-modal="mobile && uiLeftOpen ? true : undefined"
    aria-label="行笺与对话导航"
    @keydown="onDrawerKeydown"
  >
    <div class="ws__brand">
      <BrandMark :size="43" decorative />
      <div class="ws__brand-info">
        <h1>山海行笺</h1>
        <div class="ws__brand-status">
          <span class="status-dot" aria-hidden="true" />
          <span>你的 AI 旅行知己</span>
        </div>
      </div>
      <button
        type="button"
        class="ws__collapse ws__tool"
        title="收起侧边栏"
        aria-label="收起侧边栏"
        @click="isSidebarCollapsed = true"
      >
        <AppIcon name="sidebar" :size="15" />
      </button>
      <button class="ws__close ws__tool" aria-label="关闭导航" @click="uiLeftOpen = false">
        <AppIcon name="close" />
      </button>
    </div>

    <button class="ws__new" :disabled="disabled" @click="onCreateWorkspace">
      <AppIcon name="plus" :size="16" class="ws__new-icon" />
      <span>{{ busy ? '正在整理…' : '新建行笺' }}</span>
      <span class="ws__new-mark" aria-hidden="true">起笔</span>
    </button>

    <div class="ws__head">
      <span class="eyebrow">我的行笺 <span class="ws__count">{{ workspaces.length }}</span></span>
      <div class="ws__tools">
        <button
          class="ws__tool"
          :class="{ 'ws__tool--active': searchOpen }"
          :aria-expanded="searchOpen"
          aria-label="搜索行笺与对话"
          title="搜索行笺与对话"
          @click="toggleSearch"
        >
          <AppIcon name="search" :size="15" />
        </button>
        <button
          class="ws__tool"
          :title="sortOrder === 'updated' ? '按更新时间排序，点击改为创建时间' : '按创建时间排序，点击改为更新时间'"
          aria-label="切换行笺排序"
          @click="toggleSort"
        >
          <AppIcon name="sort" :size="15" />
        </button>
      </div>
    </div>

    <input
      v-if="searchOpen"
      ref="searchInput"
      v-model="keyword"
      class="ws__search field"
      type="search"
      placeholder="搜索行笺、目的地或对话"
      aria-label="搜索行笺、目的地或对话"
    >
    <p v-if="actionError" class="feedback" role="alert">{{ actionError }}</p>

    <nav class="ws__list" aria-label="我的行笺">
      <div v-for="item in workspaces" :key="item.plan.id" class="folder">
        <div class="folder__head" :class="{ 'folder__head--active': currentPlan?.id === item.plan.id }">
          <button class="folder__toggle" :aria-expanded="isExpanded(item.plan.id)" @click="toggleExpanded(item.plan.id)">
            <span class="folder__chevron" :class="{ 'folder__chevron--open': isExpanded(item.plan.id) }">
              <AppIcon name="chevron" :size="11" />
            </span>
            <AppIcon name="folder" :size="15" />
            <span class="folder__title" :title="item.plan.title">{{ item.plan.title }}</span>
          </button>
          <div class="folder__actions">
            <button
              class="folder__action"
              :disabled="disabled"
              :aria-label="`在${item.plan.title}中新建对话`"
              title="新建对话"
              @click="onNewConversation(item.plan.id)"
            >
              <AppIcon name="plus" :size="13" />
            </button>
            <button
              class="folder__action folder__action--danger"
              :disabled="disabled"
              :aria-label="`删除行笺${item.plan.title}`"
              title="删除行笺"
              @click="onRemovePlan(item.plan.id, item.plan.title)"
            >
              <AppIcon name="close" :size="12" />
            </button>
          </div>
        </div>

        <!-- 0-JS 平滑展开文件夹 -->
        <div class="collapse-shell" :class="{ collapsed: !isExpanded(item.plan.id) }">
          <div class="collapse-inner">
            <div class="folder__body">
              <button
                class="row row--plan"
                :class="{ 'row--active': mainMode === 'plan' && currentPlan?.id === item.plan.id }"
                :disabled="disabled"
                :aria-current="mainMode === 'plan' && currentPlan?.id === item.plan.id ? 'page' : undefined"
                @click="runAction(() => openPlanView(item.plan.id))"
              >
                <span class="active-indicator" />
                <AppIcon name="book" :size="14" />
                <span class="row__title">行程总览</span>
                <span class="row__version">v{{ item.plan.version }}</span>
              </button>

              <div
                v-for="conversation in item.conversations"
                :key="conversation.id"
                class="conversation-row"
                :class="{ 'conversation-row--active': mainMode === 'chat' && currentConversationId === conversation.id }"
              >
                <button
                  class="row"
                  :disabled="disabled"
                  :aria-current="mainMode === 'chat' && currentConversationId === conversation.id ? 'page' : undefined"
                  @click="runAction(() => openConversation(conversation.id))"
                >
                  <span class="active-indicator" />
                  <AppIcon name="chat" :size="13" />
                  <span class="row__title" :title="conversation.title">{{ conversation.title }}</span>
                </button>
                <button
                  class="row__remove"
                  :disabled="disabled"
                  :aria-label="`删除对话${conversation.title}`"
                  title="删除对话"
                  @click="onRemoveConversation(conversation.id, conversation.title)"
                >
                  <AppIcon name="close" :size="12" />
                </button>
              </div>

              <button v-if="!isConversationsLoaded(item.plan.id)" class="folder__empty" :disabled="disabled" @click="runAction(() => loadConversations(item.plan.id), false)">
                读取会话
              </button>
              <button v-else-if="!item.conversations.length" class="folder__empty" :disabled="disabled" @click="onNewConversation(item.plan.id)">
                <AppIcon name="plus" :size="12" />写下第一段对话
              </button>
              <button v-if="conversationsHasMore[item.plan.id]" class="folder__empty" :disabled="disabled" @click="runAction(() => loadMoreConversations(item.plan.id), false)">
                更多会话
              </button>
            </div>
          </div>
        </div>
      </div>

      <button v-if="plansHasMore" class="folder__empty" :disabled="disabled || loadingPlans" @click="runAction(() => loadMorePlans(), false)">
        更多行笺
      </button>

      <div v-if="!workspaces.length" class="ws__empty">
        <AppIcon :name="keyword ? 'search' : 'book'" :size="28" />
        <p>{{ loading || loadingPlans ? '正在翻开你的行笺…' : keyword ? '未找到相应行笺' : '山海万里，始于一笺' }}</p>
        <span v-if="!loading && !loadingPlans">{{ keyword ? '换个关键词再找找。' : '写下想去的地方，余下交给我们。' }}</span>
      </div>
    </nav>

    <div class="ws__footnote" aria-hidden="true">
      <span />行有所思 · 旅有所记<span />
    </div>

    <!-- 用户设置触发栏：呼出高斯模糊设置弹窗 -->
    <button
      type="button"
      class="ws__user"
      :class="{ 'ws__user--active': isSettingsOpen }"
      aria-label="查看账户与偏好设置"
      @click="showSettings"
    >
      <span class="ws__avatar">{{ nickname.slice(0, 1) }}</span>
      <span class="ws__user-info">
        <strong>{{ nickname }}</strong>
        <small>{{ user?.role === 'admin' ? '管理员' : '自在旅人' }}</small>
      </span>
      <AppIcon name="gear" :size="14" class="ws__user-gear" />
    </button>

    <!-- 弹窗：高斯模糊删除确认弹窗 -->
    <ConfirmModal
      :open="confirmModal.open"
      :title="confirmModal.title"
      :description="confirmModal.description"
      confirm-text="确认删除"
      :danger="true"
      :loading="busy"
      @confirm="confirmModal.onConfirm"
      @cancel="confirmModal.open = false"
    />

    <!-- 弹窗：高斯模糊用户偏好设置弹窗 -->
    <SettingsModal
      :open="isSettingsOpen"
      @close="isSettingsOpen = false"
    />
  </aside>
</template>

<style lang="scss" scoped>
@use "~/assets/styles/variables" as *;

.ws {
  width: var(--sidebar-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 24px 16px 16px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-primary);
  overflow: hidden;
  transition: width $dur-base $ease-ink, transform $dur-base $ease-ink, padding $dur-base $ease-ink, background-color $dur-base $ease-soft, border-color $dur-base $ease-soft;

  &--collapsed {
    width: 0 !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
    border-right: none !important;
    transform: translateX(-100%) !important;
    pointer-events: none !important;
  }
}

.ws__brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 6px;
  margin-bottom: 24px;
}

.ws__brand-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;

  h1 {
    margin: 0 0 3px;
    font-size: 20px;
    font-weight: 600;
    letter-spacing: 0.12em;
    white-space: nowrap;
    color: var(--text-primary);
  }
}

.ws__brand-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.02em;

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--bamboo);
    animation: breathe 1.6s ease-in-out infinite;
    flex-shrink: 0;
  }
}

.ws__collapse {
  margin-left: auto;
  color: var(--text-muted);

  &:hover {
    color: var(--text-primary);
  }

  @media (max-width: 960px) {
    display: none;
  }
}

.ws__new {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 42px;
  padding: 0 14px;
  border: 1px solid #d9b7a9;
  border-radius: 8px;
  background: var(--cinnabar-soft);
  color: var(--cinnabar);
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all $dur-base $ease-soft;

  [data-theme="dark"] & {
    border-color: rgba(217, 72, 72, 0.4);
  }

  .ws__new-icon {
    transition: transform $dur-base $ease-spring;
  }

  &:hover:not(:disabled) {
    background: #edd8cd;
    border-color: var(--cinnabar);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px var(--accent-red-subtle);

    [data-theme="dark"] & {
      background: rgba(217, 72, 72, 0.26);
    }

    .ws__new-icon {
      transform: rotate(90deg);
    }
  }

  &:active:not(:disabled) {
    transform: scale(0.98);
  }

  &:disabled { opacity: 0.6; }
}

.ws__new-mark {
  margin-left: auto;
  border-left: 1px solid rgba(172, 77, 60, 0.3);
  padding-left: 10px;
  color: var(--cinnabar);
  font-family: var(--font-serif);
  font-size: 11px;
  letter-spacing: 0.15em;
  font-weight: 600;
}

.ws__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 22px 4px 10px 6px;

  .eyebrow {
    color: var(--text-muted);
    letter-spacing: 0.12em;
  }
}

.ws__count { margin-left: 6px; color: var(--gold-deep); letter-spacing: 0; font-weight: 600; }
.ws__tools { display: flex; gap: 4px; }
.ws__tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 6px;
  transition: all $dur-fast $ease-soft;

  &:hover, &--active {
    color: var(--cinnabar);
    background: var(--cinnabar-soft);
  }
}
.ws__close { display: none; margin-left: auto; }
.ws__search { margin-bottom: 10px; font-size: 12px !important; padding: 8px 10px !important; }
.ws .feedback { margin-bottom: 10px; }

.ws__list { flex: 1; min-height: 80px; overflow-y: auto; display: grid; align-content: start; gap: 10px; padding-right: 2px; }

.folder__head {
  display: flex;
  align-items: center;
  min-height: var(--row-height);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: background-color $dur-fast $ease-soft;

  &:hover {
    background: var(--bg-sidebar-hover);
    color: var(--text-primary);

    .folder__actions { opacity: 1; }
  }

  &--active {
    color: var(--text-primary);
    font-weight: 500;
  }
}

.folder__toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: none;
  color: inherit;
  padding: 8px 4px;
  text-align: left;
  cursor: pointer;
}

.folder__chevron {
  display: flex;
  color: var(--text-muted);
  transition: transform $dur-base $ease-ink;

  &--open {
    transform: rotate(90deg);
  }
}

.folder__title {
  min-width: 0;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: transform $dur-base $ease-soft;
}

.folder__head:hover .folder__title {
  transform: translateX(2px);
}

.folder__actions {
  display: flex;
  flex-shrink: 0;
  opacity: 0;
  gap: 2px;
  transition: opacity $dur-fast $ease-soft;
}

.folder__action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 26px;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  transition: all $dur-fast $ease-spring;

  &:hover {
    color: var(--bamboo);
    background: var(--bamboo-soft);
    transform: scale(1.1);
  }

  &--danger:hover {
    color: var(--cinnabar);
    background: var(--cinnabar-soft);
  }
}

.folder__body {
  display: grid;
  gap: 3px;
  margin: 2px 0 2px 16px;
  padding: 2px 0 2px 10px;
  border-left: 1px solid var(--border-primary);
}

.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  min-height: 34px;
  padding: 7px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background-color $dur-fast $ease-soft, color $dur-fast $ease-soft;

  .active-indicator {
    position: absolute;
    left: 0;
    top: 50%;
    width: 3px;
    height: 16px;
    margin-top: -8px;
    border-radius: 2px;
    background-color: var(--cinnabar);
    transform: scaleY(0);
    transform-origin: center;
    transition: transform $dur-base $ease-spring;
  }

  &:hover {
    color: var(--text-primary);
    background: var(--bg-sidebar-hover);

    .row__title {
      transform: translateX(3px);
    }
  }

  &:disabled { opacity: 0.55; }

  &--active {
    background: var(--bg-card);
    color: var(--cinnabar);
    box-shadow: var(--shadow-sm);
    font-weight: 500;

    .active-indicator {
      transform: scaleY(1);
    }
  }

  &--plan {
    color: var(--bamboo);
    &.row--active { color: var(--cinnabar); }
  }
}

.row__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: transform $dur-base $ease-soft;
}

.row__version {
  font-size: 10px;
  color: var(--gold-deep);
  font-weight: 500;
}

.conversation-row {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: var(--radius-sm);

  .row { flex: 1; }

  &--active .row {
    background: var(--bg-card);
    color: var(--cinnabar);
    box-shadow: var(--shadow-sm);
    font-weight: 500;

    .active-indicator {
      transform: scaleY(1);
    }
  }

  &:hover .row__remove {
    opacity: 1;
  }
}

.row__remove {
  display: flex;
  justify-content: center;
  align-items: center;
  opacity: 0;
  width: 22px;
  height: 28px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  transition: all $dur-fast $ease-soft;

  &:hover {
    color: var(--cinnabar);
    background: var(--cinnabar-soft);
    transform: scale(1.1);
  }
}

.folder__empty {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 0;
  background: none;
  font-size: 11.5px;
  color: var(--text-muted);
  text-align: left;
  cursor: pointer;
  transition: color $dur-fast $ease-soft;

  &:hover { color: var(--bamboo); }
}

.ws__empty {
  padding: 28px 10px;
  text-align: center;
  color: var(--text-muted);
  animation: rise-in $dur-slow $ease-ink both;

  .app-icon { margin: 0 auto 12px; color: var(--gold); }
  p { margin: 0 0 6px; font-family: var(--font-serif); font-size: 14px; color: var(--text-primary); }
  span { font-size: 11px; line-height: 1.8; }
}

.ws__footnote {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px 0 8px;
  color: var(--text-muted);
  font-family: var(--font-serif);
  font-size: 10px;
  letter-spacing: 0.15em;

  span { width: 18px; height: 1px; background: var(--border-primary); }
}

.ws__user {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 10px 10px;
  margin-top: 4px;
  border: 1px solid transparent;
  border-top: 1px solid var(--border-primary);
  border-radius: 8px;
  background: none;
  color: var(--text-muted);
  text-align: left;
  cursor: pointer;
  transition: all $dur-fast $ease-soft;

  &:hover, &--active {
    color: var(--text-primary);
    background: var(--bg-sidebar-hover);
    border-color: var(--border-secondary);

    .ws__user-gear {
      transform: rotate(90deg);
      color: var(--cinnabar);
    }
  }
}

.ws__user-gear {
  transition: transform $dur-base $ease-spring, color $dur-fast $ease-soft;
}

.ws__avatar {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border: 1px solid var(--border-primary);
  border-radius: 50%;
  background: var(--bg-card);
  color: var(--bamboo);
  font-family: var(--font-serif);
  font-size: 14px;
  font-weight: 600;
  box-shadow: var(--shadow-sm);
  transition: transform $dur-base $ease-spring;

  .ws__user:hover & {
    transform: scale(1.08);
    color: var(--cinnabar);
    border-color: var(--cinnabar);
  }
}

.ws__user-info {
  display: grid;
  gap: 2px;
  min-width: 0;
  flex: 1;

  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-primary);
  }

  small {
    font-size: 10px;
    color: var(--text-muted);
  }
}

@media (max-width: 960px) {
  .ws { position: fixed; inset: 0 auto 0 0; z-index: 40; transform: translateX(-102%); transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 2px 0 24px rgba(0, 0, 0, 0.2); }
  .ws--open { transform: translateX(0); }
  .ws__close { display: flex; }
  .ws__brand { gap: 11px; padding: 0 5px; }
  .ws__brand h1 { font-size: 20px; }
  .folder__actions, .row__remove { opacity: 1; }
}
</style>

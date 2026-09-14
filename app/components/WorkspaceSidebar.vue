<script setup lang="ts">
const {
  workspaces,
  currentPlan,
  currentConversationId,
  mainMode,
  keyword,
  uiLeftOpen,
  loading,
  isExpanded,
  toggleExpanded,
  toggleSort,
  openWorkspace,
  openPlanView,
  openSettings,
  newSession,
  createWorkspace,
  removePlan,
  removeConversation,
} = useWorkspace()

const searchOpen = ref(false)

async function onNewSession() {
  await newSession()
}

async function onCreateWorkspace() {
  const result = await createWorkspace()
  await openPlanView(result.planId)
}

async function onNewConversation(planId: number) {
  await openWorkspace(planId)
  await newSession()
}

async function onRemovePlan(planId: number, title: string) {
  if (!window.confirm(`删除工作区「${title}」？其会话与版本将一并删除。`)) return
  await removePlan(planId)
}

async function onRemoveConversation(id: number) {
  if (!window.confirm('删除该会话及其消息记录？')) return
  await removeConversation(id)
}
</script>

<template>
  <aside class="ws" :class="{ 'ws--open': uiLeftOpen }">
    <button class="ws__new" @click="onNewSession">
      <AppIcon name="plus" :size="14" />
      新会话
    </button>

    <div class="ws__head">
      <span class="ws__head-title">工作区</span>
      <div class="ws__tools">
        <button
          class="ws__tool"
          :class="{ 'ws__tool--active': searchOpen }"
          title="搜索"
          @click="searchOpen = !searchOpen"
        >
          <AppIcon name="search" :size="15" />
        </button>
        <button class="ws__tool" title="切换排序（更新时间 / 创建时间）" @click="toggleSort">
          <AppIcon name="sort" :size="15" />
        </button>
        <button class="ws__tool" title="新建工作区" @click="onCreateWorkspace">
          <AppIcon name="plus" :size="15" />
        </button>
      </div>
    </div>
    <input
      v-if="searchOpen"
      v-model="keyword"
      class="ws__search"
      type="search"
      placeholder="搜索工作区 / 会话"
    >

    <div class="ws__list">
      <div v-for="item in workspaces" :key="item.plan.id" class="folder">
        <div
          class="folder__head"
          :class="{ 'folder__head--active': currentPlan?.id === item.plan.id }"
          @click="toggleExpanded(item.plan.id)"
        >
          <span class="folder__chevron" :class="{ 'folder__chevron--open': isExpanded(item.plan.id) }">
            <AppIcon name="chevron" :size="13" />
          </span>
          <AppIcon name="folder" :size="15" />
          <span class="folder__title">{{ item.plan.title }}</span>
          <span class="folder__count">{{ item.plan.version }}</span>
          <span class="folder__actions">
            <button class="folder__action" title="新建对话" @click.stop="onNewConversation(item.plan.id)">
              <AppIcon name="plus" :size="13" />
            </button>
            <button
              class="folder__action folder__action--danger"
              title="删除工作区"
              @click.stop="onRemovePlan(item.plan.id, item.plan.title)"
            >
              ×
            </button>
          </span>
        </div>

        <div v-show="isExpanded(item.plan.id)" class="folder__body">
          <button
            class="row row--plan"
            :class="{ 'row--active': mainMode === 'plan' && currentPlan?.id === item.plan.id }"
            @click="openPlanView(item.plan.id)"
          >
            <AppIcon name="doc" :size="15" />
            <span class="row__title">规划预览与编辑</span>
            <span class="row__version">v{{ item.plan.version }}</span>
          </button>

          <button
            v-for="conversation in item.conversations"
            :key="conversation.id"
            class="row"
            :class="{ 'row--active': mainMode === 'chat' && currentConversationId === conversation.id }"
            @click="openWorkspace(item.plan.id, { conversationId: conversation.id })"
          >
            <AppIcon name="chat" :size="14" />
            <span class="row__title">{{ conversation.title }}</span>
            <span class="row__time">{{ relativeTime(conversation.updatedAt) }}</span>
            <span class="row__remove" title="删除会话" @click.stop="onRemoveConversation(conversation.id)">×</span>
          </button>

          <p v-if="!item.conversations.length" class="folder__empty">暂无对话</p>
        </div>
      </div>

      <p v-if="!workspaces.length && !loading" class="ws__empty">还没有工作区，点击工具栏 ＋ 新建</p>
    </div>

    <button
      class="ws__settings"
      :class="{ 'ws__settings--active': mainMode === 'settings' }"
      @click="openSettings"
    >
      <AppIcon name="gear" :size="15" />
      设置
    </button>
  </aside>
</template>

<style scoped>
.ws {
  width: var(--sidebar-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: var(--paper-deep);
  border-right: 1px solid var(--line);
  overflow: hidden;
}
.ws__new {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 40px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--paper);
  color: var(--ink);
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
  flex-shrink: 0;
}
.ws__new:hover {
  border-color: var(--cinnabar);
  color: var(--cinnabar);
}
.ws__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 2px;
  margin-top: 4px;
}
.ws__head-title {
  font-size: 12px;
  letter-spacing: 0.2em;
  color: var(--ink-faint);
}
.ws__tools {
  display: flex;
  gap: 2px;
}
.ws__tool {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  color: var(--ink-faint);
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.ws__tool:hover,
.ws__tool--active {
  color: var(--cinnabar);
  background: rgba(166, 58, 47, 0.08);
}
.ws__search {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper);
  padding: 5px 8px;
  font-size: 13px;
  font-family: inherit;
}
.ws__search:focus {
  outline: none;
  border-color: var(--bamboo);
}
.ws__list {
  flex: 1;
  overflow-y: auto;
  display: grid;
  align-content: start;
  gap: 1px;
}
.folder__head {
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--row-height);
  padding: 0 4px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--ink-soft);
}
.folder__head:hover {
  background: var(--paper);
}
.folder__head--active {
  color: var(--ink);
}
.folder__chevron {
  display: flex;
  color: var(--ink-faint);
  transition: transform 0.15s;
}
.folder__chevron--open {
  transform: rotate(90deg);
}
.folder__title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.folder__count {
  font-family: var(--font-serif);
  font-size: 11px;
  color: var(--gold-deep);
}
.folder__actions {
  display: none;
  gap: 2px;
}
.folder__head:hover .folder__actions {
  display: flex;
}
.folder__action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: none;
  color: var(--ink-faint);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  border-radius: 3px;
}
.folder__action:hover {
  color: var(--bamboo);
  background: rgba(74, 114, 100, 0.1);
}
.folder__action--danger:hover {
  color: var(--cinnabar);
  background: rgba(166, 58, 47, 0.1);
}
.folder__body {
  display: grid;
  gap: 1px;
  padding: 2px 0 4px 22px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--row-height);
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--ink-soft);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.row:hover {
  background: var(--paper);
}
.row--active {
  background: var(--paper);
  color: var(--ink);
  box-shadow: inset 2px 0 0 var(--cinnabar);
}
.row--plan {
  color: var(--gold-deep);
}
.row__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__version {
  font-family: var(--font-serif);
  font-size: 11px;
  color: var(--gold-deep);
}
.row__time {
  font-size: 11px;
  color: var(--ink-faint);
}
.row__remove {
  display: none;
  padding: 0 2px;
  color: var(--ink-faint);
  font-size: 14px;
  line-height: 1;
}
.row:hover .row__remove {
  display: inline;
}
.row__remove:hover {
  color: var(--cinnabar);
}
.folder__empty {
  margin: 2px 0 2px 8px;
  font-size: 12px;
  color: var(--ink-faint);
}
.ws__empty {
  margin-top: 12px;
  font-size: 12px;
  color: var(--ink-faint);
  text-align: center;
}
.ws__settings {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px;
  border: none;
  border-top: 1px solid var(--line-soft);
  background: none;
  color: var(--ink-soft);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
}
.ws__settings:hover,
.ws__settings--active {
  color: var(--cinnabar);
}
@media (max-width: 960px) {
  .ws {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 40;
    transform: translateX(-102%);
    transition: transform 0.2s ease;
    box-shadow: 2px 0 12px rgba(43, 43, 43, 0.15);
  }
  .ws--open {
    transform: translateX(0);
  }
}
</style>

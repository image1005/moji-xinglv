<script setup lang="ts">
import { apiErrorMessage } from '~/utils/api'

const {
  workspaces, currentPlan, currentConversationId, mainMode, keyword, uiLeftOpen,
  loading, loadingPlans, errorMessage, sortOrder, isExpanded, toggleExpanded, toggleSort, openWorkspace,
  openPlanView, openSettings, newSession, createWorkspace, removePlan, removeConversation,
  plansHasMore, loadMorePlans, conversationsHasMore, loadMoreConversations,
  openConversation, isConversationsLoaded, loadConversations,
} = useWorkspace()
const { user } = useCurrentUser()
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

function onRemovePlan(planId: number, title: string) {
  if (!window.confirm(`删除行笺「${title}」？其对话与版本将一并删除，无法恢复。`)) return
  void runAction(() => removePlan(planId), false)
}

function onRemoveConversation(id: number) {
  if (!window.confirm('删除这段对话及其消息记录？此操作无法恢复。')) return
  void runAction(() => removeConversation(id), false)
}

function showSettings() {
  openSettings()
  uiLeftOpen.value = false
}
</script>

<template>
  <aside ref="drawer" class="ws" :class="{ 'ws--open': uiLeftOpen }" :inert="mobile && !uiLeftOpen" :aria-hidden="mobile && !uiLeftOpen ? true : undefined" :role="mobile ? 'dialog' : undefined" :aria-modal="mobile && uiLeftOpen ? true : undefined" aria-label="行笺与对话导航" @keydown="onDrawerKeydown">
    <div class="ws__brand">
      <span class="seal-mark" aria-hidden="true"><span>山</span><span>海</span><span>行</span><span>笺</span></span>
      <div><h1>山海行笺</h1><p>AI 旅行规划</p></div>
      <button class="ws__close ws__tool" aria-label="关闭导航" @click="uiLeftOpen = false"><AppIcon name="close" /></button>
    </div>

    <button class="ws__new" :disabled="disabled" @click="onCreateWorkspace">
      <AppIcon name="plus" :size="17" />
      <span>{{ busy ? '正在整理…' : '新建行笺' }}</span>
      <span class="ws__new-mark" aria-hidden="true">起笔</span>
    </button>

    <div class="ws__head">
      <span class="eyebrow">我的行笺 <span class="ws__count">{{ workspaces.length }}</span></span>
      <div class="ws__tools">
        <button class="ws__tool" :class="{ 'ws__tool--active': searchOpen }" :aria-expanded="searchOpen" aria-label="搜索行笺与对话" title="搜索行笺与对话" @click="toggleSearch"><AppIcon name="search" :size="15" /></button>
        <button class="ws__tool" :title="sortOrder === 'updated' ? '按更新时间排序，点击改为创建时间' : '按创建时间排序，点击改为更新时间'" aria-label="切换行笺排序" @click="toggleSort"><AppIcon name="sort" :size="15" /></button>
      </div>
    </div>
    <input v-if="searchOpen" ref="searchInput" v-model="keyword" class="ws__search field" type="search" placeholder="搜索行笺、目的地或对话" aria-label="搜索行笺、目的地或对话">
    <p v-if="actionError" class="feedback" role="alert">{{ actionError }}</p>

    <nav class="ws__list" aria-label="我的行笺">
      <div v-for="item in workspaces" :key="item.plan.id" class="folder">
        <div class="folder__head" :class="{ 'folder__head--active': currentPlan?.id === item.plan.id }">
          <button class="folder__toggle" :aria-expanded="isExpanded(item.plan.id)" @click="toggleExpanded(item.plan.id)">
            <span class="folder__chevron" :class="{ 'folder__chevron--open': isExpanded(item.plan.id) }"><AppIcon name="chevron" :size="11" /></span>
            <AppIcon name="folder" :size="16" />
            <span class="folder__title" :title="item.plan.title">{{ item.plan.title }}</span>
          </button>
          <div class="folder__actions">
            <button class="folder__action" :disabled="disabled" :aria-label="`在${item.plan.title}中新建对话`" title="新建对话" @click="onNewConversation(item.plan.id)"><AppIcon name="plus" :size="13" /></button>
            <button class="folder__action folder__action--danger" :disabled="disabled" :aria-label="`删除行笺${item.plan.title}`" title="删除行笺" @click="onRemovePlan(item.plan.id, item.plan.title)"><AppIcon name="close" :size="12" /></button>
          </div>
        </div>

        <div v-show="isExpanded(item.plan.id)" class="folder__body">
          <button class="row row--plan" :class="{ 'row--active': mainMode === 'plan' && currentPlan?.id === item.plan.id }" :disabled="disabled" :aria-current="mainMode === 'plan' && currentPlan?.id === item.plan.id ? 'page' : undefined" @click="runAction(() => openPlanView(item.plan.id))">
            <AppIcon name="book" :size="15" /><span class="row__title">行程总览</span><span class="row__version">v{{ item.plan.version }}</span>
          </button>
          <div v-for="conversation in item.conversations" :key="conversation.id" class="conversation-row" :class="{ 'conversation-row--active': mainMode === 'chat' && currentConversationId === conversation.id }">
            <button class="row" :disabled="disabled" :aria-current="mainMode === 'chat' && currentConversationId === conversation.id ? 'page' : undefined" @click="runAction(() => openConversation(conversation.id))">
              <AppIcon name="chat" :size="14" /><span class="row__title" :title="conversation.title">{{ conversation.title }}</span>
            </button>
            <button class="row__remove" :disabled="disabled" :aria-label="`删除对话${conversation.title}`" title="删除对话" @click="onRemoveConversation(conversation.id)"><AppIcon name="close" :size="12" /></button>
          </div>
          <button v-if="!isConversationsLoaded(item.plan.id)" class="folder__empty" :disabled="disabled" @click="runAction(() => loadConversations(item.plan.id), false)">读取会话</button>
          <button v-else-if="!item.conversations.length" class="folder__empty" :disabled="disabled" @click="onNewConversation(item.plan.id)"><AppIcon name="plus" :size="12" />写下第一段对话</button>
          <button v-if="conversationsHasMore[item.plan.id]" class="folder__empty" :disabled="disabled" @click="runAction(() => loadMoreConversations(item.plan.id), false)">更多会话</button>
        </div>
      </div>
      <button v-if="plansHasMore" class="folder__empty" :disabled="disabled || loadingPlans" @click="runAction(() => loadMorePlans(), false)">更多行笺</button>
      <div v-if="!workspaces.length" class="ws__empty">
        <AppIcon :name="keyword ? 'search' : 'book'" :size="28" />
        <p>{{ loading || loadingPlans ? '正在翻开你的行笺…' : keyword ? '未找到相应行笺' : '山海万里，始于一笺' }}</p>
        <span v-if="!loading && !loadingPlans">{{ keyword ? '换个关键词再找找。' : '写下想去的地方，余下交给我们。' }}</span>
      </div>
    </nav>

    <div class="ws__footnote" aria-hidden="true"><span />行有所思 · 旅有所记<span /></div>
    <button class="ws__user" :class="{ 'ws__user--active': mainMode === 'settings' }" aria-label="查看账户与偏好设置" @click="showSettings">
      <span class="ws__avatar">{{ nickname.slice(0, 1) }}</span>
      <span class="ws__user-info"><strong>{{ nickname }}</strong><small>{{ user?.role === 'admin' ? '管理员' : '自在旅人' }}</small></span>
      <AppIcon name="chevron" :size="13" />
    </button>
  </aside>
</template>

<style scoped>
.ws { width: var(--sidebar-width); flex-shrink: 0; display: flex; flex-direction: column; padding: 30px 16px 16px; background: var(--paper-deep); border-right: 1px solid var(--line); overflow: hidden; }
.ws__brand { display: flex; align-items: center; gap: 15px; padding: 0 12px; margin-bottom: 34px; }
.ws__brand h1 { margin: 0 0 5px; font-size: 23px; font-weight: 500; letter-spacing: 0.14em; white-space: nowrap; }
.ws__brand p { margin: 0; color: var(--ink-faint); font-size: 10px; letter-spacing: 0.2em; }
.ws__new { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 0 13px; border: 1px solid #d9b7a9; border-radius: 6px; background: var(--cinnabar-soft); color: var(--cinnabar); font-size: 13px; cursor: pointer; transition: background 0.18s; }
.ws__new:hover:not(:disabled) { background: #efdfd5; }
.ws__new:disabled { opacity: 0.6; }
.ws__new-mark { margin-left: auto; border-left: 1px solid #dec5b7; padding-left: 11px; color: #a8816d; font-family: var(--font-serif); font-size: 11px; letter-spacing: 0.15em; }
.ws__head { display: flex; align-items: center; justify-content: space-between; margin: 28px 4px 12px 9px; }
.ws__head .eyebrow { color: var(--ink-faint); letter-spacing: 0.12em; }
.ws__count { margin-left: 7px; color: var(--gold-deep); letter-spacing: 0; }
.ws__tools { display: flex; gap: 3px; }
.ws__tool { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: none; background: none; color: var(--ink-faint); cursor: pointer; border-radius: 4px; }
.ws__tool:hover, .ws__tool--active { color: var(--cinnabar); background: var(--cinnabar-soft); }
.ws__close { display: none; margin-left: auto; }
.ws__search { margin-bottom: 10px; font-size: 12px !important; padding: 8px 10px !important; }
.ws .feedback { margin-bottom: 10px; }
.ws__list { flex: 1; min-height: 80px; overflow-y: auto; display: grid; align-content: start; gap: 12px; }
.folder__head { display: flex; align-items: center; min-height: var(--row-height); border-radius: var(--radius-sm); color: var(--ink-soft); }
.folder__head:hover { background: #eaece2; }
.folder__head--active { color: var(--ink); }
.folder__toggle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; border: 0; background: none; color: inherit; padding: 9px 2px; text-align: left; cursor: pointer; }
.folder__chevron { display: flex; color: var(--ink-faint); transition: transform 0.18s; }
.folder__chevron--open { transform: rotate(90deg); }
.folder__title { min-width: 0; font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder__actions { display: flex; flex-shrink: 0; opacity: 0; gap: 1px; }
.folder__head:hover .folder__actions, .folder__head:focus-within .folder__actions { opacity: 1; }
.folder__action { display: flex; align-items: center; justify-content: center; width: 21px; height: 25px; padding: 0; border: none; background: none; color: var(--ink-faint); cursor: pointer; border-radius: 3px; }
.folder__action:hover { color: var(--bamboo); background: var(--bamboo-soft); }
.folder__action--danger:hover { color: var(--cinnabar); background: var(--cinnabar-soft); }
.folder__body { display: grid; gap: 3px; margin: 1px 0 0 18px; padding: 2px 0 1px 10px; border-left: 1px solid var(--line); }
.row { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; min-height: 35px; padding: 8px; border: none; border-radius: var(--radius-sm); background: none; color: var(--ink-soft); font-size: 12px; text-align: left; cursor: pointer; }
.row:hover { color: var(--ink); background: #e9ebe2; }
.row:disabled { opacity: 0.55; }
.row--active, .conversation-row--active { background: var(--paper-white); color: var(--cinnabar); box-shadow: 0 2px 7px rgb(45 56 38 / 3%); }
.row--plan { color: var(--bamboo); }
.row--plan.row--active { color: var(--cinnabar); }
.row__title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row__version { font-size: 10px; color: var(--gold-deep); }
.conversation-row { display: flex; align-items: center; border-radius: var(--radius-sm); }
.conversation-row .row { flex: 1; }
.conversation-row--active .row { color: var(--cinnabar); }
.row__remove { display: flex; justify-content: center; align-items: center; opacity: 0; width: 23px; height: 29px; padding: 0; border: 0; background: none; color: var(--ink-faint); cursor: pointer; }
.conversation-row:hover .row__remove, .conversation-row:focus-within .row__remove { opacity: 1; }
.row__remove:hover { color: var(--cinnabar); }
.folder__empty { display: flex; align-items: center; gap: 6px; padding: 8px; border: 0; background: none; font-size: 11px; color: var(--ink-faint); text-align: left; cursor: pointer; }
.ws__empty { padding: 28px 10px; text-align: center; color: var(--ink-faint); }
.ws__empty .app-icon { margin: 0 auto 14px; color: var(--gold); }
.ws__empty p { margin: 0 0 8px; font-family: var(--font-serif); font-size: 14px; }
.ws__empty span { font-size: 10px; line-height: 1.8; }
.ws__footnote { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 20px 0; color: #999785; font-family: var(--font-serif); font-size: 10px; letter-spacing: 0.13em; }
.ws__footnote span { width: 20px; height: 1px; background: var(--line); }
.ws__user { display: flex; align-items: center; gap: 11px; width: 100%; padding: 17px 11px 2px; margin-top: 8px; border: none; border-top: 1px solid var(--line); background: none; color: var(--ink-faint); text-align: left; cursor: pointer; }
.ws__user--active, .ws__user:hover { color: var(--cinnabar); }
.ws__avatar { display: grid; place-items: center; width: 34px; height: 34px; flex-shrink: 0; border: 1px solid #d3dacb; border-radius: 50%; background: #e5eade; color: var(--bamboo); font-family: var(--font-serif); font-size: 15px; }
.ws__user-info { display: grid; gap: 4px; min-width: 0; flex: 1; }
.ws__user-info strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; color: var(--ink); }
.ws__user-info small { font-size: 10px; }
@media (max-width: 960px) {
  .ws { position: fixed; inset: 0 auto 0 0; z-index: 40; transform: translateX(-102%); transition: transform 0.2s ease; box-shadow: 2px 0 24px rgb(43 43 43 / 10%); }
  .ws--open { transform: translateX(0); }
  .ws__close { display: flex; }
  .ws__brand { gap: 11px; padding: 0 5px; }
  .ws__brand h1 { font-size: 21px; }
  .folder__actions, .row__remove { opacity: 1; }
}
</style>

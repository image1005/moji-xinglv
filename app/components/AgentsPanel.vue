<script setup lang="ts">
import { api, apiErrorMessage } from '~/utils/api'

const props = defineProps<{ fixedScope?: 'plan' | 'global' }>()
const currentPlan = useBoundPlan()
const { user } = useCurrentUser()
const scope = ref<'plan' | 'global'>(props.fixedScope ?? 'plan')
const content = ref('')
const baseline = ref('')
const version = ref(0)
const status = ref('')
const saving = ref(false)
const loading = ref(false)
const isError = ref(false)
const targetPlanId = computed(() => scope.value === 'global' ? null : currentPlan.value?.id)
const tooLong = computed(() => content.value.length > 4000)
let request = 0
let active = true
let mounted = false
let loadedTarget: number | null | undefined
let loadedUser: string | undefined
type PreferenceDraft = { content: string; baseline: string; version: number }
function validateDraft(value: unknown): PreferenceDraft | null {
  const draft = value as PreferenceDraft | null
  return draft && typeof draft.content === 'string' && typeof draft.baseline === 'string' && Number.isInteger(draft.version) ? draft : null
}
const planDraft = usePlanDraft(currentPlan.value?.id, 'agents-md', validateDraft)
const globalDraft = usePlanDraft(null, 'agents-md', validateDraft)
const activeDraft = computed(() => scope.value === 'global' ? globalDraft : planDraft)
const latest = ref<{ content: string; version: number } | null>(null)
const differences = computed(() => latest.value ? [{ label: '旅行偏好', current: latest.value.content || '（留空）', draft: content.value || '（留空）' }] : null)
watch(content, () => {
  latest.value = null
  if (loading.value || loadedTarget !== targetPlanId.value) return
  if (content.value !== baseline.value) activeDraft.value.save({ content: content.value, baseline: baseline.value, version: version.value })
  else activeDraft.value.clear()
}, { flush: 'sync' })

watch(() => props.fixedScope, (value) => {
  if (value) scope.value = value
})

async function load() {
  const token = ++request
  const planId = targetPlanId.value
  loading.value = true
  content.value = ''
  baseline.value = ''
  version.value = 0
  status.value = ''
  saving.value = false
  isError.value = false
  if (!import.meta.client || planId === undefined || !user.value) { loading.value = false; return }
  loading.value = true
  try {
    const res = await api.agentsMd.get(planId)
    if (token !== request) return
    const restored = activeDraft.value.restore()
    content.value = restored?.content ?? res.content
    baseline.value = restored?.baseline ?? res.content
    version.value = restored?.version ?? res.version
    if (restored && restored.version !== res.version) status.value = '偏好已有更新，草稿仍保留，请比较最新内容后重新应用。'
    loadedTarget = planId
    loadedUser = user.value?.id
  } catch (error) {
    if (token !== request) return
    isError.value = true
    status.value = apiErrorMessage(error, '偏好加载失败，请重试')
  } finally {
    if (token === request) loading.value = false
  }
}

function syncScope() {
  if (active && mounted && (loadedTarget !== targetPlanId.value || loadedUser !== user.value?.id)) void load()
}
watch(targetPlanId, syncScope, { flush: 'post' })
watch(() => user.value?.id, (id, previous) => {
  if (previous && previous !== id) {
    request++
    content.value = ''
    baseline.value = ''
    status.value = ''
    version.value = 0
    saving.value = false
    loading.value = false
    loadedUser = undefined
  }
  syncScope()
}, { flush: 'post' })
onMounted(() => {
  mounted = true
  void load()
})
onActivated(() => {
  active = true
  if (!loading.value) syncScope()
})
onDeactivated(() => {
  active = false
  request++
  loading.value = false
  saving.value = false
})
onBeforeUnmount(() => { request++ })

async function reload() {
  if (content.value !== baseline.value && !window.confirm('重载会丢弃未保存的偏好，确定继续吗？')) return
  activeDraft.value.clear()
  await load()
}

async function compareLatest() {
  const planId = targetPlanId.value
  if (planId === undefined || saving.value || loading.value) return
  try { latest.value = await api.agentsMd.get(planId) }
  catch (error) { isError.value = true; status.value = apiErrorMessage(error) }
}
function reapplyDraft() {
  if (!latest.value) return
  baseline.value = latest.value.content
  version.value = latest.value.version
  latest.value = null
  activeDraft.value.save({ content: content.value, baseline: baseline.value, version: version.value })
  status.value = '草稿已采用最新基线，请检查后保存。'
}

async function save() {
  const planId = targetPlanId.value
  if (saving.value || loading.value || planId === undefined || !user.value) return
  if (tooLong.value) {
    isError.value = true
    status.value = '内容不能超过 4000 字，请删减后保存'
    return
  }
  const token = ++request
  const submitted = content.value
  saving.value = true
  isError.value = false
  status.value = ''
  try {
    const res = await api.agentsMd.save({ planId, content: submitted, expectedVersion: version.value })
    if (token !== request) return
    baseline.value = submitted
    version.value = res.version
    if (content.value === submitted) activeDraft.value.clear()
    else activeDraft.value.save({ content: content.value, baseline: submitted, version: res.version })
    status.value = `已保存（v${res.version}）${content.value !== submitted ? '，另有未保存修改' : ''}`
  } catch (error) {
    if (token !== request) return
    isError.value = true
    status.value = apiErrorMessage(error, '保存失败')
  } finally {
    if (token === request) saving.value = false
  }
}
</script>

<template>
  <div class="agents-panel">
    <div class="agents-panel__scope">
      <button
        v-if="!fixedScope"
        class="agents-panel__scope-btn"
        :class="{ 'agents-panel__scope-btn--active': scope === 'plan' }"
        :disabled="!currentPlan"
        @click="scope = 'plan'"
      >
        本规划
      </button>
      <button
        v-if="!fixedScope"
        class="agents-panel__scope-btn"
        :class="{ 'agents-panel__scope-btn--active': scope === 'global' }"
        @click="scope = 'global'"
      >
        全局偏好
      </button>
      <span v-if="fixedScope" class="agents-panel__scope-label">
        {{ fixedScope === 'global' ? '全局偏好' : '本规划偏好' }}
      </span>
      <span class="agents-panel__version">v{{ version }}</span>
    </div>
    <p class="agents-panel__hint">
      优先级：本规划 &gt; 全局 &gt; 系统默认。支持
      <code v-pre>{{nickname}}</code>、<code v-pre>{{currency}}</code>
      占位符；上限 4000 字，服务端会过滤注入指令。
    </p>
    <p v-if="loading" class="agents-panel__hint" role="status">正在加载偏好…</p>
    <p v-else-if="targetPlanId === undefined" class="agents-panel__hint">请先选择工作区，再编辑本规划偏好。</p>
    <ClientOnly v-else>
      <LazyMdEditor v-model="content" />
      <template #fallback>
        <textarea v-model="content" aria-label="出行偏好" maxlength="4000" class="agents-panel__fallback" rows="12" />
      </template>
    </ClientOnly>
    <p class="agents-panel__hint" :class="{ 'agents-panel__status--error': tooLong }">{{ content.length }} / 4000 字{{ tooLong ? '，请删减后保存' : '' }}</p>
    <DraftRecovery v-if="content !== baseline && !loading" :persisted="activeDraft.persisted.value" :storage-error="activeDraft.storageError.value" :busy="saving || loading" :differences="differences" @compare="compareLatest" @reapply="reapplyDraft" />
    <div class="agents-panel__actions">
      <button class="btn btn--ghost btn--small" :disabled="saving || loading || targetPlanId === undefined || !user" @click="reload">重载</button>
      <button class="btn btn--seal btn--small" :disabled="saving || loading || tooLong || targetPlanId === undefined || !user" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
    </div>
    <p v-if="status" role="status" class="agents-panel__status" :class="{ 'agents-panel__status--error': isError }">{{ status }}</p>
  </div>
</template>

<style scoped>
.agents-panel {
  display: grid;
  gap: 10px;
}
.agents-panel__scope {
  display: flex;
  gap: 6px;
  align-items: center;
}
.agents-panel__scope-btn {
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink-soft);
  font-size: 12px;
  padding: 3px 12px;
  border-radius: 3px;
  cursor: pointer;
}
.agents-panel__scope-btn--active {
  background: var(--bamboo);
  border-color: var(--bamboo);
  color: var(--paper);
}
.agents-panel__version {
  margin-left: auto;
  font-family: var(--font-serif);
  color: var(--gold-deep);
  font-size: 12px;
}
.agents-panel__scope-label {
  font-size: 12px;
  color: var(--bamboo);
}
.agents-panel__hint {
  margin: 0;
  font-size: 12px;
  color: var(--ink-faint);
  line-height: 1.7;
}
.agents-panel__hint code {
  background: var(--paper);
  border: 1px solid var(--line-soft);
  padding: 0 3px;
  border-radius: 2px;
}
.agents-panel__fallback {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 8px;
  font-size: 13px;
  font-family: inherit;
  background: var(--paper);
}
.agents-panel__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.agents-panel__status {
  margin: 0;
  font-size: 12px;
  color: var(--bamboo);
}
.agents-panel__status--error {
  color: var(--cinnabar);
}
</style>

<script setup lang="ts">
import { api, apiErrorMessage } from '~/utils/api'
import { formatDateTime, sourceLabel } from '~/utils/format'
import { versionName, type VersionMetadata } from '~/utils/version-metadata'
import { createVersionPreview, watchVersionSelection } from '~/utils/version-preview'

const props = defineProps<{ planId: number; version: VersionMetadata }>()
const emit = defineEmits<{ close: [] }>()
const ws = useWorkspace()
const dialog = ref<HTMLDialogElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const renameButton = ref<HTMLButtonElement | null>(null)
const labelId = useId()
const metadata = ref(props.version)
const preview = createVersionPreview(api.plans.versionPlan)
const { plan: snapshot, loading, error } = preview
const editing = ref(false)
const draft = ref('')
const expectedNameRevision = ref(0)
const saving = ref(false)
const refreshing = ref(false)
const renameError = ref('')
const metadataError = ref('')
const notice = ref('')
const conflict = ref(false)
const latestName = ref<VersionMetadata | null>(null)
const switching = ref(false)
const switchError = ref('')
const current = computed(() => ws.currentPlan.value?.id === props.planId && ws.currentPlan.value.version === props.version.version)
const validWorkspace = computed(() => ws.currentPlan.value?.id === props.planId)
const trimmedName = computed(() => draft.value.trim())
const nameLength = computed(() => Array.from(trimmedName.value).length)
const validName = computed(() => nameLength.value >= 1 && nameLength.value <= 40)
const nameOrigin = computed(() => ({ ai: 'AI 命名', user: '手动命名', fallback: '默认名称' })[metadata.value.nameSource ?? 'fallback'])
const changes = computed(() => metadata.value.diffJson ?? [])
const fields: Record<string, string> = { title: '行程标题', summary: '行程简介', cover: '封面', days: '每日安排', tips: '出行提示', budget: '行程预算', tags: '行程标签', foodJournal: '风物食记', checklist: '出行清单' }
const changeSummary = computed(() => [...new Set(changes.value.map(change => fields[change.path.replace(/^\//, '').split(/[.[/]/)[0] ?? ''] ?? '行程内容'))].join('、'))
const detailFields: Record<string, string> = { ...fields, name: '名称', city: '城市', date: '日期', spots: '地点', lng: '经度', lat: '纬度', time: '时间', notes: '备注', transport: '交通', lodging: '住宿', meals: '餐饮', durationMinutes: '停留时长', cost: '花费', imageUrl: '图片', panorama: '街景', address: '地址', category: '类别', restaurant: '餐厅', meal: '餐次', status: '品尝状态', rating: '评分', total: '总额', currency: '币种', breakdown: '分类明细', text: '条目内容', done: '完成状态', id: '条目标识' }
let selection = 0
let alive = true
let opener: Element | null = null
let previousOverflow = ''

function isActive(token: number) { return alive && token === selection && validWorkspace.value }
function statusOf(cause: unknown) { const value = cause as { statusCode?: number; status?: number; response?: { status?: number } } | null; return value?.statusCode ?? value?.status ?? value?.response?.status }
function changeLabel(path: string) {
  return path.replace(/\[(\d+)\]/g, '.$1').split(/[./]/).filter(Boolean).map((part, index, parts) => /^\d+$/.test(part) ? `第 ${Number(part) + 1} ${parts[index - 1] === 'days' ? '天' : '项'}` : detailFields[part] ?? (part === '$' ? '行程内容' : part)).join(' · ') || '行程内容'
}

watchVersionSelection(() => props.planId, () => props.version.version, () => {
  selection++
  metadata.value = props.version
  editing.value = false
  draft.value = ''
  saving.value = refreshing.value = switching.value = false
  renameError.value = metadataError.value = notice.value = switchError.value = ''
  conflict.value = false
  latestName.value = null
  void preview.load(props.planId, props.version.version)
  void refreshName()
})

watch(() => props.version, value => { metadata.value = value })
watch(() => ws.currentPlan.value?.id, id => { if (id !== props.planId) close() })

function close() {
  if (!alive) return
  alive = false
  preview.invalidate()
  emit('close')
}

onMounted(() => {
  opener = document.activeElement
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  dialog.value?.showModal()
})

onBeforeUnmount(() => {
  alive = false
  selection++
  preview.invalidate()
  dialog.value?.close()
  document.body.style.overflow = previousOverflow
  // SVG version nodes are focusable too. Native modal dialogs make the rest of the page inert.
  const target = opener
  void nextTick(() => {
    if (target?.isConnected && (target instanceof HTMLElement || target instanceof SVGElement)) target.focus({ preventScroll: true })
  })
})

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const elements = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, a[href], [tabindex="0"]') ?? [])].filter(element => element.getClientRects().length > 0)
  const first = elements[0]
  const last = elements.at(-1)
  if (!first) { event.preventDefault(); dialog.value?.focus(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

function backdropClick(event: MouseEvent) {
  const element = dialog.value
  if (!element || event.target !== element) return
  const bounds = element.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
}

async function refreshName() {
  if (refreshing.value || saving.value || switching.value || !validWorkspace.value) return
  const token = selection
  refreshing.value = true
  metadataError.value = ''
  try {
    const result = await ws.refreshVersionMetadata(props.version.version)
    if (!isActive(token)) return
    if (!result) { metadataError.value = '未能找到此版本的最新名称，请重试。'; return }
    metadata.value = result
    if (editing.value && (conflict.value || result.nameRevision !== expectedNameRevision.value)) {
      conflict.value = true
      latestName.value = result
      renameError.value = ''
    }
  } catch (cause) {
    if (isActive(token)) metadataError.value = apiErrorMessage(cause, '名称刷新失败，请重试。')
  } finally {
    if (isActive(token)) refreshing.value = false
  }
}

async function editName() {
  if (switching.value || !validWorkspace.value) return
  editing.value = true
  draft.value = metadata.value.name ?? ''
  expectedNameRevision.value = metadata.value.nameRevision
  renameError.value = notice.value = ''
  conflict.value = false
  latestName.value = null
  await nextTick()
  nameInput.value?.focus()
}

function cancelRename() {
  if (saving.value) return
  editing.value = false
  renameError.value = ''
  conflict.value = false
  latestName.value = null
  void nextTick(() => renameButton.value?.focus())
}

async function saveName() {
  if (saving.value || refreshing.value || switching.value || !validWorkspace.value) return
  if (!validName.value) { renameError.value = '名称去掉首尾空白后须为 1–40 字。'; return }
  if (conflict.value && !latestName.value) return
  const token = selection
  const revision = latestName.value?.nameRevision ?? expectedNameRevision.value
  saving.value = true
  renameError.value = notice.value = ''
  try {
    const result = await ws.renameVersion(props.version.version, trimmedName.value, revision)
    if (!isActive(token)) return
    if (!result) { renameError.value = '名称未保存，请重试。输入已保留。'; return }
    metadata.value = result
    editing.value = false
    conflict.value = false
    latestName.value = null
    notice.value = '版本名称已保存。'
  } catch (cause) {
    if (!isActive(token)) return
    if (statusOf(cause) === 409) {
      conflict.value = true
      latestName.value = null
      renameError.value = '名称已被其他操作修改。请读取最新名称并比较，再决定是否以你的输入重新提交。'
    } else renameError.value = apiErrorMessage(cause, '名称保存失败，请重试。输入已保留。')
  } finally {
    if (isActive(token)) {
      saving.value = false
      await nextTick()
      if (isActive(token)) (editing.value ? nameInput.value : renameButton.value)?.focus()
    }
  }
}

async function switchToVersion() {
  const activePlan = ws.currentPlan.value
  if (!activePlan || !validWorkspace.value || current.value || switching.value || saving.value || refreshing.value || editing.value) return
  if (!window.confirm(`切换到 v${props.version.version}「${versionName(metadata.value)}」？当前版本将改变；历史仍保留，之后编辑将从此版本分叉。`)) return
  const token = selection
  switching.value = true
  switchError.value = ''
  try {
    const result = await ws.switchVersion(props.version.version, activePlan.version, activePlan.revision)
    if (!isActive(token)) return
    if (result === null) switchError.value = ws.errorMessage.value || '版本切换失败，请重试。'
    else notice.value = `已切换到 v${props.version.version}。继续编辑会从此版本创建分叉。`
  } finally {
    if (isActive(token)) switching.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="version-preview" :aria-labelledby="labelId" aria-modal="true" tabindex="-1" @cancel.prevent="close" @keydown="onKeydown" @click="backdropClick">
      <div class="version-preview__shell">
        <header class="version-preview__header">
          <div><p class="version-preview__eyebrow">版本档案 · 只读预览</p><h2 :id="labelId">{{ versionName(metadata) }} <small v-if="metadata.name?.trim()">v{{ metadata.version }}</small></h2></div>
          <button type="button" class="btn btn--small" aria-label="关闭版本预览" autofocus @click="close">关闭</button>
        </header>
        <div class="version-preview__scroll">
          <div class="version-preview__metadata"><span>{{ sourceLabel(metadata.source) }}</span><time>{{ formatDateTime(metadata.createdAt) || '时间未记录' }}</time><span>{{ nameOrigin }}</span><span v-if="current" class="version-preview__current">当前版本</span></div>
          <div v-if="!editing" class="version-preview__name-tools"><button ref="renameButton" type="button" class="btn btn--small" :disabled="refreshing || switching || !validWorkspace" @click="editName">修改版本名称</button><button type="button" class="btn btn--small" :disabled="refreshing || switching || !validWorkspace" @click="refreshName">{{ refreshing ? '刷新中…' : '刷新名称' }}</button></div>
          <form v-else class="version-preview__rename" @submit.prevent="saveName">
            <label :for="`${labelId}-name`">版本名称</label>
            <input :id="`${labelId}-name`" ref="nameInput" v-model="draft" type="text" :disabled="saving" :aria-describedby="`${labelId}-name-help`" :aria-invalid="nameLength > 40" autocomplete="off">
            <p :id="`${labelId}-name-help`" class="version-preview__hint">去掉首尾空白后 1–40 字，版本号始终保留。{{ nameLength }} / 40</p>
            <div v-if="conflict" class="version-preview__conflict" role="status"><strong>名称冲突，输入已保留</strong><p v-if="latestName">最新名称：{{ versionName(latestName) }}<br>你的输入：{{ trimmedName || '（空）' }}</p><button type="button" class="btn btn--small" :disabled="refreshing || saving" @click="refreshName">{{ refreshing ? '读取中…' : '读取最新名称' }}</button><p v-if="latestName" class="version-preview__hint">比较后，点击“以我的名称重新提交”才会覆盖最新名称。</p></div>
            <p v-if="renameError" class="feedback feedback--error" role="alert">{{ renameError }}</p>
            <div class="version-preview__name-tools"><button type="submit" class="btn btn--seal btn--small" :disabled="saving || refreshing || !validName || (conflict && !latestName)">{{ saving ? '保存中…' : conflict ? '以我的名称重新提交' : '保存名称' }}</button><button type="button" class="btn btn--small" :disabled="saving" @click="cancelRename">取消改名</button></div>
          </form>
          <p v-if="metadataError" class="feedback feedback--error" role="alert">{{ metadataError }} <button type="button" class="btn btn--small" :disabled="refreshing || saving || switching" @click="refreshName">重试刷新名称</button></p>
          <details v-if="changes.length" class="version-preview__changes"><summary>变化摘要 · {{ changes.length }} 处变更 · {{ changeSummary }}</summary><ul><li v-for="(change, index) in changes.slice(0, 50)" :key="index">{{ change.kind === 'add' ? '新增' : change.kind === 'remove' ? '移除' : '更新' }}：{{ changeLabel(change.path) }}</li></ul><p v-if="changes.length > 50">另有 {{ changes.length - 50 }} 处细节变更。</p></details>
          <p v-else class="version-preview__hint">变化摘要：此版本未记录变更明细。</p>
          <div v-if="loading" class="version-preview__state" role="status" aria-live="polite">正在读取 v{{ version.version }} 的历史快照…</div>
          <div v-else-if="error" class="version-preview__state" role="alert"><p>{{ apiErrorMessage(error, '历史快照读取失败，请重试。') }}</p><button type="button" class="btn btn--small" @click="preview.load(planId, version.version)">重试加载快照</button></div>
          <PlanSnapshotView v-else-if="snapshot" :plan="snapshot" />
          <div v-else class="version-preview__state" role="status">此版本暂无可展示的行程快照。</div>
        </div>
        <footer class="version-preview__footer"><div><p v-if="switchError" class="feedback feedback--error" role="alert">{{ switchError }}</p><p v-if="notice" class="feedback" role="status">{{ notice }}</p><p class="version-preview__hint">查看与关闭预览不会改变当前行程。切换后继续编辑会从此版本分叉。</p></div><button type="button" class="btn btn--seal btn--small" :disabled="current || switching || saving || refreshing || editing || !validWorkspace || ws.offline.value" @click="switchToVersion">{{ current ? '当前版本' : switching ? '切换中…' : '切换到此版本' }}</button></footer>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.version-preview { width: min(880px, calc(100vw - 40px)); max-width: none; max-height: calc(100dvh - 40px); margin: auto; padding: 0; border: 1px solid var(--border-primary); border-radius: 8px; background: var(--bg-card); color: var(--text-primary); box-shadow: 0 20px 80px rgb(25 24 20 / 24%); }
.version-preview::backdrop { background: rgb(25 24 20 / 44%); backdrop-filter: blur(2px); }
.version-preview__shell { display: flex; flex-direction: column; max-height: calc(100dvh - 42px); }
.version-preview__header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 20px 24px 16px; border-bottom: 1px solid var(--border-primary); }
.version-preview__header > div { min-width: 0; }
.version-preview__header > button { flex-shrink: 0; }
.version-preview__eyebrow { margin: 0 0 6px; color: var(--gold-deep); font-size: 11px; letter-spacing: 0.14em; }
.version-preview h2 { margin: 0; font-family: var(--font-serif); font-size: 23px; font-weight: 500; line-height: 1.5; overflow-wrap: anywhere; }
.version-preview h2 small { display: inline-block; margin-left: 6px; color: var(--cinnabar); font-family: sans-serif; font-size: 13px; white-space: nowrap; }
.version-preview__scroll { min-height: 0; padding: 18px 24px 26px; overflow: auto; overscroll-behavior: contain; }
.version-preview__metadata { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--text-secondary); }
.version-preview__current { color: var(--cinnabar); }
.version-preview__name-tools { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.version-preview__rename { display: grid; gap: 8px; margin-top: 14px; padding: 14px; border: 1px solid var(--border-primary); border-radius: 4px; background: var(--bg-card-muted); }
.version-preview__rename label { font-size: 13px; }
.version-preview__rename input { width: 100%; min-width: 0; box-sizing: border-box; padding: 9px 12px; border: 1px solid var(--border-primary); border-radius: 4px; background: var(--bg-card); color: var(--text-primary); font: inherit; }
.version-preview__rename input:focus-visible { outline: 2px solid var(--bamboo); outline-offset: 2px; }
.version-preview__rename input[aria-invalid="true"] { border-color: var(--cinnabar); }
.version-preview__rename .version-preview__name-tools { margin: 0; }
.version-preview__hint { margin: 8px 0 0; color: var(--text-muted); font-size: 11.5px; line-height: 1.8; overflow-wrap: anywhere; }
.version-preview__rename .version-preview__hint { margin: 0; }
.version-preview__conflict { display: grid; gap: 8px; justify-items: start; padding: 12px; border-left: 3px solid var(--gold-deep); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.version-preview__conflict p { margin: 0; }
.version-preview__changes { margin: 16px 0; padding: 12px; border: 1px solid var(--border-primary); border-radius: 4px; color: var(--text-secondary); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.version-preview__changes summary { cursor: pointer; }
.version-preview__changes ul { max-height: 180px; overflow: auto; margin-bottom: 0; padding-left: 20px; }
.version-preview__scroll > .version-preview__hint { margin: 16px 0; }
.version-preview__state { display: grid; justify-items: center; gap: 12px; min-height: 180px; align-content: center; color: var(--text-secondary); text-align: center; font-size: 13px; line-height: 1.8; }
.version-preview__state p { margin: 0; }
.version-preview__footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 14px 24px; border-top: 1px solid var(--border-primary); background: var(--bg-card-muted); }
.version-preview__footer > div { flex: 1; min-width: 180px; }
.version-preview__footer > button { flex-shrink: 0; }
.version-preview__footer .version-preview__hint { margin: 0; }
.version-preview .feedback { margin: 6px 0; font-size: 12px; overflow-wrap: anywhere; }
@media (max-width: 600px) { .version-preview { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); border-radius: 5px; } .version-preview__shell { max-height: calc(100dvh - 18px); } .version-preview__header, .version-preview__footer { padding: 14px 16px; } .version-preview__scroll { padding: 14px 16px 20px; } .version-preview h2 { font-size: 20px; } }
</style>

<script setup lang="ts">
import { api, apiErrorMessage, type PlanDetail } from '~/utils/api'

const props = defineProps<{ planId: number; draftId: number }>()
const emit = defineEmits<{ close: [] }>()
const ws = useWorkspace()
const dialog = ref<HTMLDialogElement | null>(null)
const labelId = useId()
const draft = shallowRef<Awaited<ReturnType<typeof api.plans.draftPlan>>['draft'] | null>(null)
const compared = shallowRef<PlanDetail | null>(null)
const loading = ref(false)
const restoring = ref(false)
const error = ref('')
const conflict = ref(false)
const notice = ref('')
const validWorkspace = computed(() => ws.currentPlan.value?.id === props.planId)
const title = computed(() => draft.value?.status === 'active' ? '生成草稿' : draft.value && draft.value.status !== 'recoverable' ? '草稿处理结果' : '未完成草稿')
let request = 0
let alive = true
let opener: Element | null = null
let openerCard: Element | null = null
let previousOverflow = ''

function close() { if (alive) { alive = false; request++; emit('close') } }
function isActive(token: number) { return alive && request === token && validWorkspace.value }

async function load() {
  if (restoring.value || !validWorkspace.value) return
  const token = ++request
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const [result, current] = await Promise.all([api.plans.draftPlan(props.planId, props.draftId), api.plans.detail(props.planId)])
    if (!isActive(token)) return
    draft.value = result.draft
    compared.value = current
    conflict.value = false
  } catch (cause) {
    if (isActive(token)) error.value = apiErrorMessage(cause, '草稿读取失败，请重试。')
  } finally { if (isActive(token)) loading.value = false }
}

async function restore() {
  const baseline = compared.value
  if (!baseline || !draft.value || draft.value.status !== 'recoverable' || conflict.value || loading.value || restoring.value || !validWorkspace.value || ws.offline.value) return
  if (!window.confirm(`将这份未完成草稿恢复为当前行程？它将替换刚才比较的 v${baseline.version} 内容并保存为正式版本，已有历史仍保留。`)) return
  const token = request
  restoring.value = true
  error.value = ''
  try {
    const result = await ws.restoreDraft(props.draftId, baseline.version, baseline.revision)
    if (!isActive(token)) return
    if (!result) { error.value = '恢复结果尚未确认，请重新读取草稿和当前行程。'; return }
    notice.value = result.skipped ? '这份草稿已处理或与当前内容相同，未新增版本。' : `已恢复为 v${result.version}。`
    draft.value = { ...draft.value, status: result.skipped ? 'discarded' : 'committed', resultVersionId: result.versionId }
  } catch (cause) {
    if (!isActive(token)) return
    const status = (cause as { statusCode?: number; status?: number })?.statusCode ?? (cause as { status?: number })?.status
    if (status === 409) {
      conflict.value = true
      error.value = '当前行程已变化，请读取最新行程并比较，再决定是否恢复。'
    } else error.value = apiErrorMessage(cause, '恢复未完成，请重新读取草稿和当前行程后重试。')
  } finally { if (isActive(token)) restoring.value = false }
}

watch([() => props.planId, () => props.draftId], () => { draft.value = null; compared.value = null; void load() }, { immediate: true })
watch(() => ws.currentPlan.value?.id, id => { if (id !== props.planId) close() })
onMounted(() => {
  opener = document.activeElement
  openerCard = opener?.closest('.preview-card') ?? null
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  dialog.value?.showModal()
})
onBeforeUnmount(() => {
  alive = false
  request++
  dialog.value?.close()
  document.body.style.overflow = previousOverflow
  const target = opener?.isConnected ? opener : openerCard?.querySelector('button')
  void nextTick(() => { if (target?.isConnected && (target instanceof HTMLElement || target instanceof SVGElement)) target.focus({ preventScroll: true }) })
})
function backdropClick(event: MouseEvent) {
  const element = dialog.value
  if (!element || event.target !== element) return
  const rect = element.getBoundingClientRect()
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const elements = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') ?? [])].filter(element => element.getClientRects().length)
  const first = elements[0], last = elements.at(-1)
  if (!first) { event.preventDefault(); dialog.value?.focus() }
  else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="draft-preview" :aria-labelledby="labelId" aria-modal="true" tabindex="-1" @cancel.prevent="close" @click="backdropClick" @keydown="onKeydown">
      <header class="draft-preview__header"><div><p>部分成果 · 只读预览</p><h2 :id="labelId">{{ title }}</h2></div><button type="button" class="btn btn--small" autofocus @click="close">关闭草稿预览</button></header>
      <div class="draft-preview__body">
        <p v-if="loading" role="status">正在读取草稿和当前行程…</p>
        <p v-if="error" class="feedback" role="alert">{{ error }}</p>
        <button v-if="error || draft?.status === 'active'" type="button" class="btn btn--small" :disabled="loading || restoring" @click="load">{{ conflict ? '读取最新行程并比较' : '重新读取草稿和当前行程' }}</button>
        <section v-if="compared" class="draft-preview__comparison" aria-label="当前正式版本"><strong>当前正式版本 v{{ compared.version }} · {{ compared.title }}</strong><p>{{ compared.plan.summary || '此版本尚无行程简介。' }}</p><p>共 {{ compared.plan.days.length }} 天，预算 {{ compared.plan.budget.total }} {{ compared.plan.budget.currency }}。恢复会采用下方整份草稿，保留此前历史。</p></section>
        <p v-if="draft?.status === 'active'" class="draft-preview__hint">这份草稿仍在生成，暂不能恢复。完整完成后将自动保存正式版本；停止或失败后可重新读取部分成果。</p>
        <p v-else-if="draft && draft.status !== 'recoverable'" class="draft-preview__hint">这份草稿已经处理，无需再次恢复。</p>
        <PlanSnapshotView v-if="draft" :plan="draft.plan" />
      </div>
      <footer class="draft-preview__footer"><p role="status">{{ notice || '查看和关闭不会修改行程。确认恢复时会检查刚才读取的当前版本。' }}</p><button v-if="draft?.status === 'recoverable'" type="button" class="btn btn--seal btn--small" :disabled="loading || restoring || conflict || !compared || !validWorkspace || ws.offline.value" @click="restore">{{ restoring ? '正在恢复…' : '确认恢复这份草稿' }}</button></footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.draft-preview { width: min(860px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); margin: auto; padding: 0; border: 1px solid var(--border-primary); border-radius: 8px; color: var(--text-primary); background: var(--bg-card); box-shadow: var(--shadow-float); }
.draft-preview::backdrop { background: rgb(25 24 20 / 44%); backdrop-filter: blur(2px); }
.draft-preview__header, .draft-preview__footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 22px; }
.draft-preview__header { border-bottom: 1px solid var(--border-primary); }
.draft-preview__header h2 { margin: 4px 0 0; font-family: var(--font-serif); font-size: 23px; font-weight: 500; }
.draft-preview__header p, .draft-preview__footer p, .draft-preview__hint { margin: 0; color: var(--text-muted); font-size: 12px; line-height: 1.8; }
.draft-preview__body { display: grid; gap: 16px; max-height: calc(100dvh - 210px); overflow: auto; overscroll-behavior: contain; padding: 20px 22px; }
.draft-preview__comparison { border-left: 3px solid var(--gold-deep); padding: 12px; background: var(--bg-card-muted); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.draft-preview__comparison p { margin: 4px 0 0; }
.draft-preview__footer { flex-wrap: wrap; border-top: 1px solid var(--border-primary); }
.draft-preview__footer p { flex: 1; min-width: 180px; }
@media (max-width: 600px) { .draft-preview { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); } .draft-preview__header, .draft-preview__body, .draft-preview__footer { padding: 14px; } }
</style>

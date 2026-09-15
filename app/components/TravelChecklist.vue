<script setup lang="ts">
import { ChecklistItemSchema, PlanSchema, type Plan } from '#shared/schemas/plan'
import { apiErrorMessage } from '~/utils/api'

const { currentPlan, savePlan, errorMessage, loading } = useWorkspace()
const items = computed(() => currentPlan.value?.plan.checklist ?? [])
const completed = computed(() => items.value.filter((item) => item.done).length)
const progress = computed(() => items.value.length ? Math.round(completed.value / items.value.length * 100) : 0)
const saving = ref(false)
const busy = computed(() => saving.value || loading.value)
const text = ref('')
const failure = ref('')
const feedback = ref('')
type Snapshot = { planId: number; version: number; plan: Plan }
const draft = shallowRef<Snapshot | null>(null)
let scope = 0

function snapshot(): Snapshot | null {
  const current = currentPlan.value
  return current ? { planId: current.id, version: current.version, plan: PlanSchema.parse(current.plan) } : null
}

function beginAdd() {
  if (busy.value || draft.value) return
  draft.value = snapshot()
  text.value = ''
  failure.value = ''
  feedback.value = ''
}

async function persist(base: Snapshot, message: string) {
  if (busy.value || currentPlan.value?.id !== base.planId) return false
  const token = scope
  saving.value = true
  failure.value = ''
  feedback.value = ''
  try {
    const result = await savePlan(base.plan, base.version)
    if (token !== scope || currentPlan.value?.id !== base.planId) return false
    if (!result) {
      failure.value = errorMessage.value || '未能保存，请稍后重试。'
      return false
    }
    feedback.value = result.skipped ? '内容未变化。' : `${message} · 已存为 v${result.version}`
    return true
  } catch (error) {
    if (token === scope) failure.value = apiErrorMessage(error)
    return false
  } finally {
    if (token === scope) saving.value = false
  }
}

async function addItem() {
  const base = draft.value
  if (!base || busy.value) return
  const result = ChecklistItemSchema.safeParse({ id: crypto.randomUUID(), text: text.value.trim(), done: false })
  if (!result.success) {
    failure.value = '请填写 1—200 字的待办事项。'
    return
  }
  const next = { ...base, plan: PlanSchema.parse(base.plan) }
  next.plan.checklist.push(result.data)
  if (await persist(next, '清单已添入')) {
    if (draft.value === base) {
      draft.value = null
      text.value = ''
    }
  }
}

async function toggleItem(id: string) {
  if (busy.value || draft.value) return
  const base = snapshot()
  const item = base?.plan.checklist.find((entry) => entry.id === id)
  if (!base || !item) return
  item.done = !item.done
  await persist(base, item.done ? '已标记完成' : '已恢复为待办')
}

async function removeItem(id: string) {
  if (busy.value || draft.value) return
  const base = snapshot()
  const index = base?.plan.checklist.findIndex((entry) => entry.id === id) ?? -1
  const item = base?.plan.checklist[index]
  if (!base || !item || !window.confirm(`从出行清单删除「${item.text}」？历史版本仍会保留。`)) return
  base.plan.checklist.splice(index, 1)
  await persist(base, '清单事项已删除')
}

watch(() => currentPlan.value?.id, () => {
  scope++
  saving.value = false
  draft.value = null
  text.value = ''
  failure.value = ''
  feedback.value = ''
}, { flush: 'sync' })
onBeforeUnmount(() => { scope++ })
</script>

<template>
  <section v-if="currentPlan" class="travel-checklist" aria-label="出行清单">
    <header><div><span class="travel-checklist__eyebrow">行前小笺</span><h3>万事妥帖，再出发</h3></div><button type="button" :disabled="busy || !!draft || items.length >= 100" @click="beginAdd">添一项</button></header>
    <div v-if="items.length" class="travel-checklist__progress"><span>{{ completed }} / {{ items.length }} 已备妥</span><progress :value="progress" max="100" :aria-label="`清单完成进度 ${progress}%`" /><span>{{ progress }}%</span></div>
    <ul v-if="items.length"><li v-for="item in items" :key="item.id"><button type="button" class="travel-checklist__item" role="checkbox" :aria-checked="item.done" :aria-label="`${item.done ? '取消完成' : '标记完成'}：${item.text}`" :class="{ done: item.done }" :disabled="busy || !!draft" @click="toggleItem(item.id)"><span class="travel-checklist__box" aria-hidden="true" /><span>{{ item.text }}</span></button><button type="button" class="travel-checklist__delete" :disabled="busy || !!draft" :aria-label="`删除${item.text}`" @click="removeItem(item.id)">删除</button></li></ul>
    <p v-else class="travel-checklist__empty">证件、车票，或记得带一把伞。把需要准备的事写下来，出发时更从容。</p>
    <form v-if="draft" @submit.prevent="addItem"><label for="travel-checklist-text">待办事项 <span>基于 v{{ draft.version }}</span></label><input id="travel-checklist-text" v-model="text" required maxlength="200" :disabled="busy" placeholder="例如：确认酒店入住时间" ><p v-if="currentPlan.version !== draft.version" class="travel-checklist__warning">行笺已有新版本；请保留内容后取消，重新添入以免覆盖。</p><div class="travel-checklist__form-actions"><button type="button" :disabled="busy" @click="draft = null; failure = ''">取消</button><button type="submit" class="travel-checklist__save" :disabled="busy">{{ saving ? '正在落笔…' : '添入清单' }}</button></div></form>
    <p v-if="failure" class="travel-checklist__failure" role="alert">{{ failure }}</p><p v-if="feedback" class="travel-checklist__feedback" role="status">{{ feedback }}</p>
  </section>
</template>

<style scoped>
.travel-checklist { border: 1px solid var(--line); border-top: 2px solid var(--gold, #b89557); background: var(--paper); padding: 24px; border-radius: 4px; color: var(--ink); }
.travel-checklist header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }.travel-checklist__eyebrow { font-size: 10px; color: var(--gold, #9b7b43); letter-spacing: .16em; }.travel-checklist h3 { font: 600 22px var(--font-serif, 'Songti SC', SimSun, serif); margin: 8px 0 0; letter-spacing: .04em; }
.travel-checklist button { font: inherit; font-size: 12px; color: var(--ink-soft); cursor: pointer; border: 1px solid var(--line); background: var(--paper); padding: 7px 12px; border-radius: 3px; flex-shrink: 0; }.travel-checklist button:hover:not(:disabled) { border-color: var(--gold, #b89557); }.travel-checklist button:disabled { opacity: .45; cursor: not-allowed; }.travel-checklist button:focus-visible, .travel-checklist input:focus-visible { outline: 2px solid var(--gold, #b89557); outline-offset: 3px; }
.travel-checklist__progress { display: flex; align-items: center; gap: 14px; margin-top: 23px; color: var(--ink-faint); font-size: 10px; }.travel-checklist progress { appearance: none; height: 3px; flex: 1; min-width: 0; border: 0; background: var(--line); accent-color: var(--bamboo, #4a7264); }.travel-checklist progress::-webkit-progress-bar { background: var(--line); }.travel-checklist progress::-webkit-progress-value { background: var(--bamboo, #4a7264); }.travel-checklist progress::-moz-progress-bar { background: var(--bamboo, #4a7264); }
.travel-checklist ul { list-style: none; margin: 16px 0 0; padding: 0; display: grid; }.travel-checklist li { display: flex; align-items: center; gap: 16px; border-bottom: 1px solid var(--line); }.travel-checklist li:last-child { border-bottom: 0; }.travel-checklist .travel-checklist__item { display: flex; flex: 1; gap: 11px; align-items: center; min-width: 0; text-align: left; border: 0; padding: 13px 0; background: transparent; font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; }.travel-checklist__box { position: relative; width: 15px; height: 15px; box-sizing: border-box; border: 1px solid #b8955780; border-radius: 2px; flex-shrink: 0; }.done .travel-checklist__box { background: var(--bamboo, #4a7264); border-color: var(--bamboo, #4a7264); }.done .travel-checklist__box::after { content: ''; position: absolute; width: 6px; height: 3px; border-left: 1px solid white; border-bottom: 1px solid white; transform: rotate(-45deg); left: 3px; top: 4px; }.done > span:last-child { text-decoration: line-through; color: var(--ink-faint); }.travel-checklist .travel-checklist__delete { border: 0; padding: 5px 0; font-size: 10px; color: var(--ink-faint); background: transparent; }.travel-checklist .travel-checklist__delete:hover:not(:disabled) { color: var(--cinnabar, #a63a2f); }.travel-checklist__empty { font-size: 12px; line-height: 1.9; color: var(--ink-faint); margin: 19px 0 0; }
.travel-checklist form { padding: 18px; margin-top: 18px; border: 1px dashed var(--line); background: var(--paper-deep); }.travel-checklist label { font-size: 12px; color: var(--ink-soft); display: flex; justify-content: space-between; gap: 8px; }.travel-checklist label > span { font-size: 10px; color: var(--ink-faint); }.travel-checklist input { font: inherit; font-size: 13px; padding: 10px; border: 1px solid var(--line); border-radius: 3px; color: var(--ink); background: var(--paper); box-sizing: border-box; width: 100%; margin-top: 9px; }.travel-checklist__form-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 13px; }.travel-checklist .travel-checklist__save { background: var(--cinnabar, #a63a2f); color: #fff9ef; border-color: var(--cinnabar, #a63a2f); }
.travel-checklist__failure, .travel-checklist__feedback, .travel-checklist__warning { margin: 15px 0 0; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }.travel-checklist__failure, .travel-checklist__warning { color: var(--cinnabar, #a63a2f); }.travel-checklist__feedback { color: var(--bamboo, #4a7264); }
@media (max-width: 620px) { .travel-checklist { padding: 18px; }.travel-checklist h3 { font-size: 20px; }.travel-checklist form { padding: 14px; } }
</style>

<script setup lang="ts">
import { FoodEntrySchema, PlanSchema, type FoodEntry, type Plan } from '#shared/schemas/plan'
import { apiErrorMessage } from '~/utils/api'

const { currentPlan, savePlan, errorMessage, loading } = useWorkspace()
const query = ref('')
const filter = ref<'all' | FoodEntry['status']>('all')
const saving = ref(false)
const failure = ref('')
const feedback = ref('')
const busy = computed(() => saving.value || loading.value)
const entries = computed(() => currentPlan.value?.plan.foodJournal ?? [])
const tasted = computed(() => entries.value.filter((entry) => entry.status === 'tasted').length)
const wishlist = computed(() => entries.value.length - tasted.value)
const filteredEntries = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return entries.value.filter((entry) => (filter.value === 'all' || filter.value === entry.status)
    && (!keyword || [entry.name, entry.restaurant, entry.city, entry.address, entry.date, entry.notes, ...entry.tags].join(' ').toLocaleLowerCase().includes(keyword)))
})
const mealNames: Record<FoodEntry['meal'], string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '小食' }
const mealMarks: Record<FoodEntry['meal'], string> = { breakfast: '晨', lunch: '午', dinner: '暮', snack: '闲' }
const filters = [{ value: 'all', label: '全部风味' }, { value: 'wishlist', label: '想尝尝' }, { value: 'tasted', label: '已尝过' }] as const

type Snapshot = { planId: number; version: number; plan: Plan }
const editor = shallowRef<(Snapshot & { entryId: string | null }) | null>(null)
const form = reactive({ name: '', restaurant: '', city: '', address: '', date: '', meal: 'snack' as FoodEntry['meal'], status: 'wishlist' as FoodEntry['status'], cost: '0', rating: '0', notes: '', tags: '' })
let scope = 0

function snapshot(): Snapshot | null {
  const current = currentPlan.value
  return current ? { planId: current.id, version: current.version, plan: PlanSchema.parse(current.plan) } : null
}

function clearNotice() {
  failure.value = ''
  feedback.value = ''
}

function openEditor(entryId: string | null = null) {
  if (busy.value || editor.value) return
  const base = snapshot()
  if (!base) return
  const entry = base.plan.foodJournal.find((item) => item.id === entryId)
  if (entryId !== null && !entry) return
  Object.assign(form, {
    name: entry?.name ?? '', restaurant: entry?.restaurant ?? '', city: entry?.city ?? '', address: entry?.address ?? '',
    date: entry?.date ?? '', meal: entry?.meal ?? 'snack', status: entry?.status ?? 'wishlist',
    cost: String(entry?.cost ?? 0), rating: String(entry?.rating ?? 0), notes: entry?.notes ?? '',
    tags: (entry?.tags ?? []).join('、'),
  })
  editor.value = { ...base, entryId }
  clearNotice()
}

async function persist(base: Snapshot, next: Plan, message: string) {
  if (busy.value || currentPlan.value?.id !== base.planId) return false
  const token = scope
  saving.value = true
  clearNotice()
  try {
    const result = await savePlan(next, base.version)
    if (token !== scope || currentPlan.value?.id !== base.planId) return false
    if (!result) {
      failure.value = errorMessage.value || '未能保存，请稍后重试。草稿仍保留。'
      return false
    }
    feedback.value = result.skipped ? '内容未变化，无需新增版本。' : `${message} · 已存为 v${result.version}`
    return true
  } catch (error) {
    if (token === scope) failure.value = apiErrorMessage(error)
    return false
  } finally {
    if (token === scope) saving.value = false
  }
}

async function submit() {
  const base = editor.value
  if (!base || busy.value) return
  const next = PlanSchema.parse(base.plan)
  const index = next.foodJournal.findIndex((item) => item.id === base.entryId)
  const result = FoodEntrySchema.safeParse({
    ...(index >= 0 ? next.foodJournal[index] : {}), ...form,
    id: base.entryId ?? crypto.randomUUID(), name: form.name.trim(), restaurant: form.restaurant.trim(), city: form.city.trim(), address: form.address.trim(),
    cost: Number(form.cost), rating: Number(form.rating),
    tags: form.tags.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 12),
  })
  if (!result.success) {
    failure.value = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；')
    return
  }
  if (index < 0) next.foodJournal.push(result.data)
  else next.foodJournal[index] = result.data
  if (await persist(base, next, base.entryId ? '风味记录已更新' : '风味记录已添入')) {
    if (editor.value === base) editor.value = null
  }
}

async function toggleStatus(id: string) {
  if (busy.value || editor.value) return
  const base = snapshot()
  const item = base?.plan.foodJournal.find((entry) => entry.id === id)
  if (!base || !item) return
  item.status = item.status === 'wishlist' ? 'tasted' : 'wishlist'
  await persist(base, base.plan, item.status === 'tasted' ? '已记为尝过' : '已移回想尝清单')
}

async function removeEntry(id: string) {
  if (busy.value || editor.value) return
  const base = snapshot()
  const index = base?.plan.foodJournal.findIndex((entry) => entry.id === id) ?? -1
  const entry = base?.plan.foodJournal[index]
  if (!base || !entry || !window.confirm(`删除「${entry.name}」这条风味记录？历史版本仍会保留。`)) return
  base.plan.foodJournal.splice(index, 1)
  await persist(base, base.plan, '风味记录已删除')
}

watch(() => currentPlan.value?.id, () => {
  scope++
  saving.value = false
  editor.value = null
  query.value = ''
  filter.value = 'all'
  clearNotice()
}, { flush: 'sync' })
onBeforeUnmount(() => { scope++ })
</script>

<template>
  <section class="food-journal" aria-label="美食手账">
    <header class="food-journal__hero">
      <div><span class="food-journal__eyebrow">一城一味 · 食在旅途</span><h2>人间烟火，值得一记</h2><p>收好想尝的味道，也留住舌尖的回忆。</p></div>
      <span class="food-journal__hero-seal" aria-hidden="true">食<br>记</span>
    </header>

    <div v-if="!currentPlan" class="food-journal__empty"><h3>先展开一本行笺</h3><p>选择或新建工作区，即可拥有专属美食手账。</p></div>
    <template v-else>
      <div class="food-journal__summary">
        <div><strong>{{ wishlist }}</strong><span>味道 · 想尝尝</span></div><div><strong>{{ tasted }}</strong><span>回忆 · 已尝过</span></div>
        <button type="button" class="food-journal__seal" :disabled="busy || !!editor || entries.length >= 300" @click="openEditor()">记一道风味</button>
      </div>

      <div class="food-journal__toolbar">
        <div class="food-journal__filters" aria-label="筛选记录"><button v-for="option in filters" :key="option.value" type="button" :class="{ active: filter === option.value }" :aria-pressed="filter === option.value" @click="filter = option.value">{{ option.label }}</button></div>
        <label class="food-journal__search"><span class="food-journal__sr-only">搜索菜名、餐厅、城市或笔记</span><input v-model="query" type="search" placeholder="寻一道菜、一家店、一座城…" maxlength="200" ></label>
      </div>

      <form v-if="editor" class="food-journal__editor" @submit.prevent="submit">
        <div class="food-journal__editor-heading"><h3>{{ editor.entryId ? '重温这一味' : '留下一味烟火' }}</h3><span>基于 v{{ editor.version }}</span></div>
        <p v-if="currentPlan.version !== editor.version" class="food-journal__warning">行笺已有新版本。本草稿不会覆盖它；请保留所填内容，取消后重新打开编辑。</p>
        <fieldset :disabled="busy">
          <label class="food-journal__wide">菜名 / 风味名称 <span>必填</span><input v-model="form.name" required maxlength="200" placeholder="例如：一碗片儿川" ></label>
          <label>餐厅 / 小店<input v-model="form.restaurant" maxlength="200" placeholder="想去的店，或偶遇的摊" ></label>
          <label>城市<input v-model="form.city" maxlength="200" placeholder="风味来自哪座城" ></label>
          <label class="food-journal__wide">地址<input v-model="form.address" maxlength="500" placeholder="记下位置，下次不迷路" ></label>
          <label>日期<input v-model="form.date" type="date" ></label>
          <label>餐次<select v-model="form.meal"><option v-for="(name, key) in mealNames" :key="key" :value="key">{{ name }}</option></select></label>
          <label>状态<select v-model="form.status"><option value="wishlist">想尝尝</option><option value="tasted">已尝过</option></select></label>
          <label>人均花费 / {{ editor.plan.budget.currency }}<input v-model="form.cost" type="number" required min="0" max="1000000" step="any" ></label>
          <label>心中评分<select v-model="form.rating"><option value="0">0 · 暂不评分</option><option v-for="score in 5" :key="score" :value="String(score)">{{ score }} / 5</option></select></label>
          <label class="food-journal__wide">风味标签<input v-model="form.tags" type="text" maxlength="480" placeholder="逗号分隔，例如：面食、老字号、早点" ></label>
          <p class="food-journal__hint">默认记为「想尝尝」，只有你确认后才算尝过。日期可以留白，评分由你决定。</p>
          <label class="food-journal__wide">风味笔记<textarea v-model="form.notes" rows="4" maxlength="4000" placeholder="味道如何、想点什么、忌口提醒，或与谁分享…" /></label>
        </fieldset>
        <div class="food-journal__editor-actions"><button type="button" :disabled="busy" @click="editor = null; failure = ''">取消</button><button type="submit" class="food-journal__seal" :disabled="busy">{{ saving ? '正在落笔…' : '保存这一味' }}</button></div>
      </form>
      <p v-if="failure" class="food-journal__failure" role="alert">{{ failure }}</p>
      <p v-if="feedback" class="food-journal__feedback" role="status">{{ feedback }}</p>

      <div v-if="!entries.length && !editor" class="food-journal__empty"><div class="food-journal__empty-pattern" aria-hidden="true"><span>味</span></div><h3>风味未记，来日方长</h3><p>先收下一家心仪的小店。<br>等真正尝过，再写下属于你的评价。</p><button type="button" class="food-journal__seal" :disabled="busy" @click="openEditor()">收下第一道风味</button></div>
      <div v-else-if="!filteredEntries.length && entries.length" class="food-journal__empty food-journal__empty--search"><h3>这一页，暂时留白</h3><p>换个关键词，或看看全部风味。</p><button type="button" @click="query = ''; filter = 'all'">清除筛选</button></div>

      <div v-if="filteredEntries.length" class="food-journal__cards">
        <article v-for="entry in filteredEntries" :key="entry.id" class="food-journal__card" :class="{ 'is-tasted': entry.status === 'tasted' }">
          <div class="food-journal__card-top"><span class="food-journal__meal-mark" aria-hidden="true">{{ mealMarks[entry.meal] }}</span><span class="food-journal__meal">{{ mealNames[entry.meal] }}<small>{{ entry.date || '日期待记' }}</small></span><span class="food-journal__status">{{ entry.status === 'tasted' ? '已尝过' : '想尝尝' }}</span></div>
          <h3>{{ entry.name }}</h3>
          <p class="food-journal__restaurant">{{ entry.restaurant || '店名待记' }}<span v-if="entry.city"> · {{ entry.city }}</span></p>
          <p v-if="entry.address" class="food-journal__address">{{ entry.address }}</p>
          <div class="food-journal__details"><span>人均 <strong>{{ currentPlan.plan.budget.currency }} {{ entry.cost.toLocaleString('zh-CN') }}</strong></span><span>{{ entry.rating ? `${entry.rating} / 5 分` : '尚未评分' }}</span></div>
          <p class="food-journal__notes" :class="{ 'is-empty': !entry.notes }">{{ entry.notes || (entry.status === 'wishlist' ? '把期待先收好，等一场味蕾的相逢。' : '味道尝过了，笔记可以慢慢写。') }}</p>
          <div v-if="entry.tags.length" class="food-journal__tags"><span v-for="(tag, index) in entry.tags" :key="index">{{ tag }}</span></div>
          <footer class="food-journal__card-actions"><button type="button" class="food-journal__toggle" :disabled="busy || !!editor" @click="toggleStatus(entry.id)">{{ entry.status === 'wishlist' ? '我尝过了' : '移回想尝' }}</button><button type="button" :disabled="busy || !!editor" :aria-label="`编辑${entry.name}`" @click="openEditor(entry.id)">编辑</button><button type="button" class="food-journal__delete" :disabled="busy || !!editor" :aria-label="`删除${entry.name}`" @click="removeEntry(entry.id)">删除</button></footer>
        </article>
      </div>
      <p v-if="entries.length" class="food-journal__footnote">共 {{ entries.length }} 条风味记录，当前显示 {{ filteredEntries.length }} 条。每次修改随行笺保存为新版本，不改写历史。</p>
    </template>
  </section>
</template>

<style scoped>
.food-journal { color: var(--ink); display: grid; gap: 24px; }
.food-journal h2, .food-journal h3 { font-family: var(--font-serif, 'Noto Serif SC', 'Songti SC', SimSun, serif); font-weight: 600; margin: 0; }
.food-journal button, .food-journal input, .food-journal select, .food-journal textarea { font: inherit; }.food-journal button { border: 1px solid var(--line); padding: 8px 12px; border-radius: 4px; background: var(--paper); color: var(--ink-soft); font-size: 12px; cursor: pointer; transition: background .18s, border-color .18s; }.food-journal button:hover:not(:disabled) { border-color: var(--gold, #b89557); background: var(--paper-deep); }.food-journal button:disabled { cursor: not-allowed; opacity: .4; }.food-journal button:focus-visible, .food-journal input:focus-visible, .food-journal select:focus-visible, .food-journal textarea:focus-visible { outline: 2px solid var(--gold, #b89557); outline-offset: 3px; }
.food-journal__hero { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 8px 0; }.food-journal__eyebrow { color: var(--gold, #9b7b43); font-size: 11px; letter-spacing: .16em; }.food-journal__hero h2 { font-size: 29px; letter-spacing: .04em; margin-top: 12px; }.food-journal__hero p { margin: 12px 0 0; color: var(--ink-faint); font-size: 12px; }.food-journal__hero-seal { font: 18px / 1.4 var(--font-serif, SimSun, serif); border: 1px solid var(--cinnabar, #a63a2f); padding: 7px 9px; color: var(--cinnabar, #a63a2f); outline: 1px solid #a63a2f40; outline-offset: 3px; transform: rotate(-5deg); margin-right: 6px; flex-shrink: 0; }
.food-journal__summary { display: flex; gap: 35px; align-items: center; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 19px 0; }.food-journal__summary > div { display: flex; gap: 10px; align-items: baseline; }.food-journal__summary strong { font: 34px Georgia, serif; color: var(--ink); }.food-journal__summary span { font-size: 11px; color: var(--ink-faint); }.food-journal__summary > button { margin-left: auto; }.food-journal .food-journal__seal { background: var(--cinnabar, #a63a2f); color: #fff9ef; border-color: var(--cinnabar, #a63a2f); box-shadow: inset 0 0 0 2px var(--paper, #f8f4eb); padding: 10px 17px; letter-spacing: .07em; flex-shrink: 0; }.food-journal .food-journal__seal:hover:not(:disabled) { background: #88362d; border-color: #88362d; }
.food-journal__toolbar { display: flex; gap: 16px; align-items: center; justify-content: space-between; flex-wrap: wrap; }.food-journal__filters { display: flex; gap: 5px; }.food-journal__filters button { border: 0; background: transparent; padding: 8px 13px; color: var(--ink-faint); }.food-journal__filters button.active { color: var(--cinnabar, #a63a2f); background: #a63a2f0c; }.food-journal__search { flex: 0 1 280px; }.food-journal__search input { width: 100%; box-sizing: border-box; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); font-size: 12px; padding: 10px 12px; color: var(--ink); }.food-journal__sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.food-journal__cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 18px; align-items: start; }.food-journal__card { border: 1px solid var(--line); border-top: 2px solid var(--gold, #b89557); padding: 23px 23px 0; background: var(--paper); border-radius: 3px; min-width: 0; }.food-journal__card.is-tasted { border-top-color: var(--bamboo, #4a7264); }.food-journal__card-top { display: flex; align-items: center; gap: 11px; margin-bottom: 20px; }.food-journal__meal-mark { display: grid; place-items: center; width: 39px; height: 39px; border: 1px solid #b8955750; color: var(--gold, #9b7b43); font: 24px var(--font-serif, SimSun, serif); background: #b8955708; border-radius: 50%; }.food-journal__meal { display: grid; gap: 4px; font-size: 11px; color: var(--ink-soft); }.food-journal__meal small { font-size: 10px; color: var(--ink-faint); }.food-journal__status { margin-left: auto; font-size: 10px; color: #927239; border: 1px solid #b8955740; padding: 4px 7px; border-radius: 2px; white-space: nowrap; }.is-tasted .food-journal__status { border-color: #4a726440; color: var(--bamboo, #4a7264); }.food-journal__card h3 { font-size: 23px; line-height: 1.5; letter-spacing: .03em; overflow-wrap: anywhere; }.food-journal__restaurant { font-size: 12px; line-height: 1.8; margin: 8px 0 0; color: var(--ink-soft); overflow-wrap: anywhere; }.food-journal__restaurant > span { color: var(--ink-faint); }.food-journal__address { font-size: 11px; color: var(--ink-faint); line-height: 1.8; margin: 5px 0 0; overflow-wrap: anywhere; }.food-journal__details { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--ink-faint); border-top: 1px dashed var(--line); padding-top: 15px; margin-top: 17px; }.food-journal__details strong { color: var(--ink-soft); font-weight: 500; }.food-journal__details > span:last-child { color: var(--gold, #9b7b43); }.food-journal__notes { font-size: 12px; line-height: 1.95; color: var(--ink-soft); white-space: pre-wrap; overflow-wrap: anywhere; margin: 18px 0 21px; }.food-journal__notes.is-empty { color: var(--ink-faint); font-size: 11px; }.food-journal__tags { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 17px; }.food-journal__tags > span { font-size: 10px; color: var(--ink-faint); background: var(--paper-deep); border-radius: 2px; padding: 3px 6px; }.food-journal__card-actions { display: flex; gap: 14px; align-items: center; border-top: 1px solid var(--line); padding: 12px 0; }.food-journal__card-actions button { border: 0; padding: 4px 0; background: transparent; font-size: 11px; }.food-journal__card-actions .food-journal__toggle { margin-right: auto; color: var(--bamboo, #4a7264); }.food-journal__card-actions .food-journal__delete { color: var(--cinnabar, #a63a2f); }
.food-journal__empty { padding: 46px 22px; text-align: center; border: 1px dashed var(--line); }.food-journal__empty-pattern { display: grid; place-items: center; width: 72px; height: 72px; border: 1px solid #b8955745; border-radius: 50%; margin: 0 auto 25px; outline: 1px solid #b8955725; outline-offset: 6px; }.food-journal__empty-pattern > span { font: 32px var(--font-serif, SimSun, serif); color: var(--gold, #9b7b43); }.food-journal__empty h3 { font-size: 23px; letter-spacing: .06em; }.food-journal__empty p { font-size: 12px; color: var(--ink-faint); line-height: 2; margin: 13px 0 22px; }.food-journal__empty--search { padding: 30px 20px; }.food-journal__footnote { margin: 0; text-align: center; color: var(--ink-faint); font-size: 10px; line-height: 1.8; }
.food-journal__editor { background: var(--paper); border: 1px solid var(--gold, #b89557); border-radius: 4px; padding: 24px; }.food-journal__editor-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 21px; }.food-journal__editor-heading h3 { font-size: 22px; }.food-journal__editor-heading > span { font-size: 11px; color: var(--ink-faint); }.food-journal__editor fieldset { border: 0; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }.food-journal__editor label { display: grid; gap: 7px; color: var(--ink-soft); font-size: 12px; }.food-journal__editor label > span { font-size: 10px; color: var(--cinnabar, #a63a2f); }.food-journal__editor input, .food-journal__editor select, .food-journal__editor textarea { font-size: 13px; width: 100%; box-sizing: border-box; min-width: 0; border: 1px solid var(--line); background: var(--paper-warm, #fcfaf5); border-radius: 3px; padding: 10px 11px; color: var(--ink); }.food-journal__editor textarea { resize: vertical; }.food-journal__wide { grid-column: 1 / -1; }.food-journal__hint { margin: 0; font-size: 11px; line-height: 1.9; color: var(--ink-faint); align-self: center; }.food-journal__editor-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 22px; }
.food-journal__failure, .food-journal__feedback, .food-journal__warning { padding: 12px 15px; margin: 0; font-size: 12px; line-height: 1.8; border-radius: 4px; overflow-wrap: anywhere; }.food-journal__failure, .food-journal__warning { background: #a63a2f0b; color: var(--cinnabar, #a63a2f); border: 1px solid #a63a2f25; }.food-journal__feedback { background: #4a72640c; color: var(--bamboo, #4a7264); border: 1px solid #4a726425; }.food-journal__warning { margin-bottom: 17px; }
@media (max-width: 620px) { .food-journal__hero h2 { font-size: 22px; }.food-journal__summary { gap: 20px; flex-wrap: wrap; }.food-journal__summary > div { gap: 8px; }.food-journal__summary strong { font-size: 28px; }.food-journal__summary > button { margin-left: 0; }.food-journal__search { flex-basis: 100%; }.food-journal__toolbar { gap: 12px; }.food-journal__editor { padding: 18px; }.food-journal__editor fieldset { grid-template-columns: 1fr; }.food-journal__card { padding: 20px 20px 0; } }
</style>

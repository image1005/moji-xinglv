<script setup lang="ts">
import { api, apiErrorMessage, type PlanDetail } from '~/utils/api'
import { isDraftForm, mergeDraftFields, type DraftDifference } from '~/utils/draft-merge'
import { reviewPlan } from '#shared/utils/plan-review'

const { currentPlan, versions, loading, errorMessage, updatePlanMeta, switchVersion, mainMode, loadVersions, versionsHasMore, loadingVersions } = useWorkspace()
const planId = currentPlan.value?.id
const detail = useBoundPlan()
const history = shallowRef([...versions.value])
const editing = ref(false)
const editingVersion = ref(currentPlan.value?.version)
const editingRevision = ref(currentPlan.value?.revision)
const busy = ref(false)
const message = ref('')
const success = ref('')
const form = reactive({ title: '', summary: '', contentMd: '', cover: '', tags: '', tips: '', budgetTotal: '', budgetCurrency: 'CNY' })
const breakdown = ref<{ label: string; amount: string }[]>([])
const emit = defineEmits<{ editMap: [] }>()
const checks = computed(() => detail.value ? reviewPlan(detail.value.plan) : [])
const baseFields = shallowRef<ReturnType<typeof metaFields> | null>(null)
const latest = shallowRef<PlanDetail | null>(null)
const differences = ref<DraftDifference[] | null>(null)
type MetaDraft = { version: number; revision: number; form: typeof form; breakdown: typeof breakdown.value; base: NonNullable<typeof baseFields.value> }
const draft = usePlanDraft<MetaDraft>(planId, 'plan-metadata', (value) => {
  const data = value as MetaDraft | null
  return data && Number.isInteger(data.version) && Number.isInteger(data.revision)
    && isDraftForm(data.form, form) && data.base && isDraftForm(data.base, { ...form, breakdown: [] })
    && Array.isArray(data.breakdown) && data.breakdown.every((row) => isDraftForm(row, { label: '', amount: '' }))
    && Array.isArray(data.base.breakdown) && data.base.breakdown.every((row) => isDraftForm(row, { label: '', amount: '' })) ? data : null
})
onActivated(() => { if (currentPlan.value?.id === planId) void loadVersions() })
watch([editing, form, breakdown, editingVersion, editingRevision, baseFields], () => {
  if (editing.value && baseFields.value && editingVersion.value !== undefined && editingRevision.value !== undefined) {
    draft.save({ version: editingVersion.value, revision: editingRevision.value, form: { ...form }, breakdown: breakdown.value.map((row) => ({ ...row })), base: baseFields.value })
  }
  differences.value = null
}, { deep: true, flush: 'sync' })
onMounted(() => {
  const value = draft.restore()
  if (!value) return
  Object.assign(form, value.form)
  breakdown.value = value.breakdown
  baseFields.value = value.base
  editingVersion.value = value.version
  editingRevision.value = value.revision
  editing.value = true
})

function metaFields(source: PlanDetail) {
  return { title: source.title, summary: source.summary, contentMd: source.contentMd, cover: source.plan.cover, tags: source.plan.tags.join('、'), tips: source.plan.tips.join('\n'), budgetTotal: String(source.plan.budget.total), budgetCurrency: source.plan.budget.currency, breakdown: Object.entries(source.plan.budget.breakdown ?? {}).map(([label, amount]) => ({ label, amount: String(amount) })) }
}
const labels = { title: '名称', summary: '简介', contentMd: '旅行手记', cover: '封面', tags: '标签', tips: '行前小记', budgetTotal: '总预算', budgetCurrency: '币种', breakdown: '预算明细' }
function mergeEditor(source: PlanDetail) {
  return mergeDraftFields(baseFields.value!, { ...form, breakdown: breakdown.value }, metaFields(source), labels)
}
async function compareLatest() {
  if (!planId || !baseFields.value || disabled.value) return
  try {
    latest.value = await api.plans.detail(planId)
    differences.value = mergeEditor(latest.value).differences
  } catch (error) { message.value = apiErrorMessage(error) }
}
function reapplyDraft() {
  if (!latest.value || !baseFields.value) return
  const merged = mergeEditor(latest.value).merged
  const { breakdown: rows, ...fields } = merged
  Object.assign(form, fields)
  breakdown.value = rows
  baseFields.value = metaFields(latest.value)
  editingVersion.value = latest.value.version
  editingRevision.value = latest.value.revision
  differences.value = null
  latest.value = null
  message.value = ''
  success.value = '草稿已应用到最新内容，请检查后保存。'
}

function fillForm(source: NonNullable<typeof currentPlan.value>) {
  form.title = source.title
  form.summary = source.summary
  form.contentMd = source.contentMd
  form.cover = source.plan.cover
  form.tags = source.plan.tags.join('、')
  form.tips = source.plan.tips.join('\n')
  form.budgetTotal = String(source.plan.budget.total)
  form.budgetCurrency = source.plan.budget.currency
  breakdown.value = Object.entries(source.plan.budget.breakdown ?? {})
    .map(([label, amount]) => ({ label, amount: String(amount) }))
}

function parseTags(text: string) {
  return text.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 30)
}

function parseTips(text: string) {
  return text.split(/\n/).map((item) => item.trim()).filter(Boolean).slice(0, 100)
}
const spotCount = computed(() => detail.value?.plan.days.reduce((sum, day) => sum + day.spots.length, 0) ?? 0)
const cities = computed(() => [...new Set(detail.value?.plan.days.map((day) => day.city).filter(Boolean) ?? [])])
const disabled = computed(() => busy.value || loading.value)
const budgetItems = computed(() => Object.entries(detail.value?.plan.budget.breakdown ?? {}))
const budgetMax = computed(() => Math.max(1, ...budgetItems.value.map(([, amount]) => amount)))

watch([currentPlan, versions], () => {
  if (currentPlan.value?.id !== planId) return
  detail.value = currentPlan.value
  history.value = [...versions.value]
  if (!editing.value && detail.value) fillForm(detail.value)
}, { immediate: true })

function editMeta() {
  if (!editing.value && detail.value) {
    editingVersion.value = detail.value.version
    editingRevision.value = detail.value.revision
    fillForm(detail.value)
    baseFields.value = metaFields(detail.value)
  }
  if (editing.value) draft.clear()
  editing.value = !editing.value
  message.value = ''
  success.value = ''
}

async function saveMeta() {
  if (disabled.value || currentPlan.value?.id !== planId) return
  if (!form.title.trim()) {
    message.value = '请为这份行笺起一个名字。'
    return
  }
  const total = Number(form.budgetTotal)
  if (!Number.isFinite(total) || total < 0) {
    message.value = '预算总额需为不小于 0 的数字。'
    return
  }
  const currency = form.budgetCurrency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) {
    message.value = '币种需为三个大写字母，例如 CNY。'
    return
  }
  const breakdownValue: Record<string, number> = {}
  for (const row of breakdown.value) {
    const label = row.label.trim()
    if (!label) continue
    const amount = Number(row.amount)
    if (!Number.isFinite(amount) || amount < 0) {
      message.value = `预算明细「${label}」的金额需为不小于 0 的数字。`
      return
    }
    breakdownValue[label] = amount
  }
  busy.value = true
  message.value = ''
  success.value = ''
  try {
    const result = await updatePlanMeta({
      title: form.title.trim(),
      summary: form.summary,
      cover: form.cover.trim(),
      tags: parseTags(form.tags),
      tips: parseTips(form.tips),
      budget: { total, currency, ...(Object.keys(breakdownValue).length ? { breakdown: breakdownValue } : {}) },
      contentMd: form.contentMd,
    }, editingVersion.value, editingRevision.value)
    if (result === null) {
      message.value = errorMessage.value || '保存未完成，编辑内容已保留。'
      return
    }
    editing.value = false
    draft.clear()
    success.value = '行笺资料已保存。'
  } catch (error) {
    message.value = apiErrorMessage(error, '保存未完成，编辑内容已保留。')
  } finally {
    busy.value = false
  }
}

async function doSwitch(version: number) {
  if (disabled.value || currentPlan.value?.id !== planId) return
  if (!window.confirm(`切换到 v${version}？当前版本将变为 v${version}，历史版本仍保留。`)) return
  busy.value = true
  message.value = ''
  success.value = ''
  try {
    if (await switchVersion(version) === null) {
      message.value = errorMessage.value || '切换版本失败，请重试。'
      return
    }
    success.value = `已切换到 v${version}，历史版本完整保留。`
  } catch (error) {
    message.value = apiErrorMessage(error, '切换版本失败，请重试。')
  } finally {
    busy.value = false
  }
}

function amount(value: number) {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
</script>

<template>
  <div v-if="detail" class="itinerary">
    <header class="itinerary__head">
      <div><p class="eyebrow">山海行笺 / TRAVEL JOURNAL</p><h1>{{ detail.title }}</h1><p class="itinerary__summary">{{ detail.summary || '把心中的远方，慢慢写成沿途的风景。' }}</p></div>
      <span class="itinerary__seal" aria-hidden="true">山海<br>可期</span>
    </header>
    <div class="itinerary__meta-row"><div class="itinerary__tags"><span v-for="tag in detail.plan.tags" :key="tag" class="itinerary__tag">{{ tag }}</span><span class="itinerary__version">行笺 v{{ detail.version }}</span></div><button class="btn btn--ghost btn--small" :disabled="disabled" :aria-expanded="editing" @click="editMeta"><AppIcon name="doc" :size="13" />{{ editing ? '取消编辑' : '编辑资料' }}</button></div>
    <p v-if="message" class="feedback" role="alert">{{ message }}</p>
    <p v-if="success" class="feedback feedback--success" role="status">{{ success }}</p>
    <form v-if="editing" class="panel itinerary__edit" @submit.prevent="saveMeta">
      <p v-if="editingRevision !== undefined && detail.revision > editingRevision" class="feedback" role="status">行笺已有更新。草稿仍保留，请比较最新内容后明确重新应用。</p>
      <DraftRecovery :persisted="draft.persisted.value" :storage-error="draft.storageError.value" :busy="disabled" :differences="differences" @compare="compareLatest" @reapply="reapplyDraft" />
      <label class="field">行笺名称<input v-model="form.title" type="text" maxlength="200" required :disabled="disabled"></label>
      <label class="field">旅程简介<textarea v-model="form.summary" rows="2" maxlength="4000" :disabled="disabled" /></label>
      <label class="field">封面图地址<input v-model="form.cover" type="url" maxlength="2048" placeholder="https://… 或本站地图代理地址，可留空" :disabled="disabled"></label>
      <label class="field">行程标签<input v-model="form.tags" type="text" placeholder="逗号分隔，例如：江南、人文、慢旅行" :disabled="disabled"></label>
      <label class="field">行前小记<textarea v-model="form.tips" rows="3" placeholder="每行一条，例如：十月杭州早晚微凉，备一件薄外套" :disabled="disabled" /></label>
      <fieldset class="itinerary__budget-edit" :disabled="disabled">
        <legend>旅程预算</legend>
        <div class="itinerary__budget-total">
          <label class="field">总额<input v-model="form.budgetTotal" type="number" min="0" step="any" :disabled="disabled"></label>
          <label class="field">币种<input v-model="form.budgetCurrency" type="text" maxlength="3" placeholder="CNY" :disabled="disabled"></label>
        </div>
        <div v-for="(row, index) in breakdown" :key="index" class="itinerary__budget-row">
          <label class="field">分类<input v-model="row.label" type="text" maxlength="80" placeholder="例如：住宿" :disabled="disabled"></label>
          <label class="field">金额<input v-model="row.amount" type="number" min="0" step="any" :disabled="disabled"></label>
          <button type="button" class="btn btn--ghost btn--small" :disabled="disabled" @click="breakdown.splice(index, 1)">删除</button>
        </div>
        <button type="button" class="btn btn--ghost btn--small" :disabled="disabled" @click="breakdown.push({ label: '', amount: '' })">添加明细</button>
      </fieldset>
      <label class="field">旅行手记 · Markdown<textarea v-model="form.contentMd" rows="5" :disabled="disabled" /></label>
      <div><button class="btn btn--seal" :disabled="disabled" type="submit">{{ busy ? '正在保存…' : '保存资料' }}</button></div>
    </form>

    <section class="itinerary__stats" aria-label="行程概览">
      <div><span class="itinerary__stat-label"><AppIcon name="calendar" :size="14" />旅行天数</span><strong>{{ detail.plan.days.length }}<small>天</small></strong></div>
      <div><span class="itinerary__stat-label"><AppIcon name="pin" :size="14" />沿途风景</span><strong>{{ spotCount }}<small>处</small></strong></div>
      <div><span class="itinerary__stat-label"><AppIcon name="compass" :size="14" />途经城市</span><strong>{{ cities.length }}<small>城</small></strong></div>
      <div><span class="itinerary__stat-label"><AppIcon name="wallet" :size="14" />旅程预算</span><strong class="itinerary__stat-budget">{{ detail.plan.budget.total ? amount(detail.plan.budget.total) : '待定' }}<small v-if="detail.plan.budget.total">{{ detail.plan.budget.currency }}</small></strong></div>
    </section>

    <section v-if="checks.length" class="panel itinerary__review" aria-label="行程检查">
      <div class="section-title"><h2>行前核对</h2><button class="btn btn--ghost btn--small" @click="emit('editMap')">前往路线编辑</button></div>
      <ul><li v-for="(check, index) in checks" :key="`${check.code}:${index}`">{{ check.dayIndex === undefined ? '' : `第 ${check.dayIndex + 1} 日 · ` }}{{ check.message }}</li></ul>
    </section>
    <div class="itinerary__columns">
      <div class="itinerary__route">
        <div class="section-title"><h2>日行一程</h2><span>循着心意，慢慢走</span></div>
        <div v-if="!detail.plan.days.length" class="panel empty-state"><AppIcon name="mountain" :size="35" /><h3>远方，尚待落笔</h3><p>告诉 AI 目的地、天数与喜好，<br>一起起草第一份旅行计划。</p><button class="btn btn--seal" @click="mainMode = 'chat'">聊聊旅行心愿<AppIcon name="arrow" :size="14" /></button></div>
        <section v-for="(day, index) in detail.plan.days" :key="index" class="day-card">
          <header class="day-card__head"><span class="day-card__index">{{ String(index + 1).padStart(2, '0') }}</span><div><p class="eyebrow">第 {{ index + 1 }} 日</p><h3>{{ day.city || '自在漫游' }}</h3></div><span class="day-card__date">{{ day.date || '日期待定' }}</span></header>
          <ol class="day-card__spots">
            <li v-for="(spot, spotIndex) in day.spots" :key="spotIndex" class="spot">
              <span class="spot__dot" aria-hidden="true" />
              <div class="spot__info"><span class="spot__time">{{ spot.time || `第 ${spotIndex + 1} 站` }}</span><h4>{{ spot.name }}</h4><p v-if="spot.address" class="spot__address"><AppIcon name="pin" :size="11" />{{ spot.address }}</p><p v-if="spot.notes" class="spot__notes">{{ spot.notes }}</p></div>
              <div v-if="spot.panorama.startsWith('/api/panorama')" class="spot__thumb"><CachedImage :src="spot.panorama" :alt="`${spot.name} 街景`" /></div>
            </li>
          </ol>
          <p v-if="!day.spots.length" class="day-card__empty">这一日留白，等一场不期而遇。</p>
          <dl v-if="day.transport || day.lodging || day.meals.length" class="day-card__meta"><div v-if="day.transport"><dt>行</dt><dd>{{ day.transport }}</dd></div><div v-if="day.lodging"><dt>宿</dt><dd>{{ day.lodging }}</dd></div><div v-if="day.meals.length"><dt>食</dt><dd>{{ day.meals.join(' · ') }}</dd></div></dl>
        </section>
        <TravelChecklist />
        <section v-if="detail.contentMd" class="panel itinerary__notes"><p class="eyebrow">沿途有记</p><h2>旅行手记</h2><MDC class="mdc" :value="detail.contentMd" /></section>
      </div>

      <aside class="itinerary__aside" aria-label="预算与旅行提示">
        <section class="panel budget"><p class="eyebrow">心中有数</p><h2>旅程预算</h2><p class="budget__total">{{ detail.plan.budget.total ? amount(detail.plan.budget.total) : '尚未估算' }}<small v-if="detail.plan.budget.total">{{ detail.plan.budget.currency }}</small></p><p class="budget__hint">规划估算，以实际支出为准</p><ul v-if="budgetItems.length" class="budget__breakdown"><li v-for="[label, value] in budgetItems" :key="label"><div><span>{{ label }}</span><strong>{{ amount(value) }}</strong></div><span class="budget__track"><i :style="{ width: `${(value / budgetMax) * 100}%` }" /></span></li></ul></section>
        <section v-if="detail.plan.tips.length" class="panel tips"><p class="eyebrow">临行叮咛</p><h2>行前小记</h2><ul><li v-for="(tip, index) in detail.plan.tips" :key="index"><span>{{ String(index + 1).padStart(2, '0') }}</span><p>{{ tip }}</p></li></ul></section>
        <section class="itinerary__quote" aria-hidden="true"><span />不必匆忙，<br>好风景值得慢慢看。<span /></section>
      </aside>
    </div>

    <section class="itinerary__history"><div class="section-title"><h2>行笺留痕</h2><span>每一版旅程，都值得留存</span></div><ul v-if="history.length" class="version-list"><li v-for="version in history" :key="version.id" class="version-item"><span class="version-item__tag">v{{ version.version }}</span><span class="version-item__source">{{ sourceLabel(version.source) }}</span><span class="version-item__time">{{ formatDateTime(version.createdAt) }}</span><span v-if="version.version === detail.version" class="version-item__current">当前版本</span><button v-else class="btn btn--ghost btn--small" :disabled="disabled" @click="doSwitch(version.version)">切换到此版</button></li></ul><p v-else class="itinerary__history-empty">保存第一版行程后，可在这里回看与恢复历史。</p><button v-if="versionsHasMore" class="btn btn--ghost btn--small" :disabled="loadingVersions" @click="loadVersions(true)">{{ loadingVersions ? '正在翻页…' : '更多历史版本' }}</button></section>
  </div>
</template>

<style scoped>
.itinerary { display: grid; gap: 24px; font-size: 13px; }
.itinerary__head { display: flex; align-items: center; justify-content: space-between; gap: 30px; }
.itinerary__head h1 { margin: 11px 0 10px; color: var(--ink); font-size: clamp(27px, 3vw, 37px); font-weight: 500; letter-spacing: 0.05em; line-height: 1.45; overflow-wrap: anywhere; }
.itinerary__summary { max-width: 720px; margin: 0; color: var(--ink-soft); font-size: 12px; line-height: 1.9; }
.itinerary__seal { flex-shrink: 0; width: 47px; height: 50px; padding: 8px 4px; border: 1px solid var(--cinnabar); border-radius: 2px; color: var(--cinnabar); font-family: var(--font-serif); font-size: 14px; line-height: 1.15; letter-spacing: 0.1em; text-align: center; transform: rotate(4deg); }
.itinerary__meta-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: -5px; }
.itinerary__tags { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.itinerary__tag { font-size: 10px; color: var(--bamboo); background: var(--bamboo-soft); border-radius: 3px; padding: 4px 8px; }
.itinerary__version { font-size: 10px; color: var(--gold-deep); border: 1px solid #e4dac7; border-radius: 3px; padding: 3px 8px; }
.itinerary__meta-row > .btn { flex-shrink: 0; }
.itinerary__edit { display: grid; gap: 15px; border-style: dashed; }
.itinerary__budget-edit { display: grid; gap: 12px; margin: 0; padding: 14px 16px; border: 1px dashed var(--line); border-radius: 6px; }
.itinerary__budget-edit legend { padding: 0 6px; color: var(--gold-deep); font-family: var(--font-serif); font-size: 13px; letter-spacing: 0.12em; }
.itinerary__budget-edit > .btn { justify-self: start; }
.itinerary__budget-total { display: grid; grid-template-columns: minmax(0, 1fr) 120px; gap: 12px; }
.itinerary__budget-row { display: grid; grid-template-columns: minmax(0, 1fr) 150px auto; gap: 12px; align-items: end; }
@media (max-width: 540px) { .itinerary__budget-total { grid-template-columns: 1fr; } .itinerary__budget-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .itinerary__budget-row > .btn { grid-column: 1 / -1; justify-self: start; } }
.itinerary__stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 22px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.itinerary__stats > div { display: grid; gap: 14px; padding: 0 24px; border-right: 1px solid var(--line); }
.itinerary__stats > div:first-child { padding-left: 0; }
.itinerary__stats > div:last-child { border-right: 0; }
.itinerary__stat-label { display: flex; align-items: center; gap: 7px; color: var(--ink-faint); font-size: 10px; }
.itinerary__stats strong { font-family: var(--font-serif); font-size: 27px; font-weight: 500; line-height: 1; }
.itinerary__stats small { margin-left: 7px; color: var(--ink-faint); font-family: var(--font-body); font-size: 10px; font-weight: 400; }
.itinerary__stats .itinerary__stat-budget { color: var(--cinnabar); font-size: 24px; }
.itinerary__columns { display: grid; grid-template-columns: minmax(0, 1fr) 250px; gap: 26px; padding-top: 5px; }
.itinerary__route { display: grid; align-content: start; gap: 20px; min-width: 0; }
.section-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.section-title h2 { margin: 0; font-size: 19px; font-weight: 500; letter-spacing: 0.07em; }
.section-title > span { font-size: 10px; color: var(--ink-faint); }
.day-card { overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: var(--paper-white); }
.day-card__head { display: flex; gap: 15px; align-items: center; padding: 19px 22px; border-bottom: 1px solid var(--line-soft); background: #f8f8f1; }
.day-card__index { display: flex; align-items: center; justify-content: center; width: 40px; height: 42px; border-right: 1px solid #dfdacc; padding-right: 12px; color: var(--gold-deep); font-family: var(--font-serif); font-size: 27px; }
.day-card__head .eyebrow { font-size: 9px; }
.day-card__head h3 { margin: 3px 0 0; font-size: 17px; font-weight: 500; }
.day-card__date { margin-left: auto; font-size: 10px; color: var(--ink-faint); }
.day-card__spots { list-style: none; margin: 0; padding: 24px 23px 6px; }
.spot { position: relative; display: flex; gap: 15px; margin-left: 4px; padding: 0 0 27px 23px; border-left: 1px solid #dfe3d8; }
.spot:last-child { border-left-color: transparent; padding-bottom: 18px; }
.spot__dot { position: absolute; top: 3px; left: -4px; width: 7px; height: 7px; border: 1px solid var(--bamboo); border-radius: 50%; background: var(--paper-white); }
.spot:first-child .spot__dot { background: var(--bamboo); box-shadow: 0 0 0 3px var(--bamboo-soft); }
.spot__info { flex: 1; min-width: 0; }
.spot__time { display: block; color: var(--gold-deep); font-size: 10px; }
.spot h4 { margin: 7px 0 6px; font-family: var(--font-body); font-weight: 500; font-size: 14px; }
.spot__notes { margin: 6px 0 0; color: var(--ink-soft); font-size: 11px; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; }
.spot__address { display: flex; align-items: flex-start; gap: 4px; margin: 0; color: var(--ink-faint); font-size: 10px; line-height: 1.7; }
.spot__address .app-icon { margin-top: 3px; }
.spot__thumb { width: 84px; height: 62px; margin-top: 20px; border-radius: 4px; overflow: hidden; border: 1px solid var(--line); flex-shrink: 0; }
.day-card__empty { margin: 0; padding: 0 23px 24px; font-size: 12px; color: var(--ink-faint); }
.day-card__meta { display: grid; gap: 11px; margin: 0 22px; padding: 17px 0 20px; border-top: 1px dashed var(--line); }
.day-card__meta > div { display: flex; align-items: flex-start; gap: 10px; }
.day-card__meta dt { display: grid; place-items: center; width: 20px; height: 20px; border: 1px solid #e0decd; border-radius: 3px; color: var(--gold-deep); font-family: var(--font-serif); font-size: 11px; flex-shrink: 0; }
.day-card__meta dd { margin: 0; color: var(--ink-soft); font-size: 11px; line-height: 1.9; }
.itinerary__route .empty-state > .app-icon { margin: 0 auto; color: var(--gold); }
.itinerary__aside { display: grid; gap: 19px; align-content: start; padding-top: 43px; }
.itinerary__aside .panel { padding: 23px 21px; }
.itinerary__aside h2, .itinerary__notes h2 { margin: 6px 0 19px; font-size: 20px; font-weight: 500; }
.budget__total { margin: 0; color: var(--cinnabar); font-family: var(--font-serif); font-size: 29px; }
.budget__total small { margin-left: 7px; color: var(--ink-faint); font-family: var(--font-body); font-size: 10px; }
.budget__hint { margin: 8px 0 0; color: var(--ink-faint); font-size: 9px; }
.budget__breakdown { display: grid; gap: 17px; list-style: none; margin: 24px 0 0; padding: 0; }
.budget__breakdown li > div { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; color: var(--ink-soft); }
.budget__breakdown strong { color: var(--ink); font-size: 11px; font-weight: 500; }
.budget__track { display: block; height: 3px; margin-top: 8px; background: var(--paper-deep); }
.budget__track i { display: block; height: 100%; background: #abb8a3; }
.budget__breakdown li:nth-child(even) .budget__track i { background: #c2ad80; }
.tips ul { list-style: none; display: grid; gap: 17px; padding: 0; margin: 0; }
.tips li { display: flex; gap: 10px; }
.tips li > span { padding-top: 2px; color: var(--gold-deep); font-family: var(--font-serif); font-size: 12px; }
.tips li > p { margin: 0; font-size: 11px; line-height: 1.9; color: var(--ink-soft); }
.itinerary__quote { padding: 15px; color: #93937e; font-family: var(--font-serif); font-size: 14px; line-height: 2.1; text-align: center; letter-spacing: 0.1em; }
.itinerary__quote > span { display: block; width: 22px; height: 1px; background: var(--line); margin: 0 auto 16px; }
.itinerary__quote > span:last-child { margin: 16px auto 0; }
.itinerary__history { padding-top: 14px; }
.version-list { list-style: none; margin: 18px 0 0; padding: 0; border-top: 1px solid var(--line); }
.version-item { display: flex; align-items: center; gap: 14px; min-height: 51px; border-bottom: 1px solid var(--line-soft); font-size: 11px; color: var(--ink-soft); }
.version-item__tag { min-width: 29px; color: var(--gold-deep); font-family: var(--font-serif); font-size: 14px; }
.version-item__time { color: var(--ink-faint); margin-left: auto; font-size: 10px; }
.version-item__current { width: 72px; text-align: center; color: var(--bamboo); font-size: 10px; }
.itinerary__history-empty { padding: 20px 0; font-size: 12px; color: var(--ink-faint); }
@media (max-width: 1200px) { .itinerary__columns { grid-template-columns: minmax(0, 1fr) 220px; gap: 20px; } .itinerary__stats > div { padding: 0 17px; } }
@media (max-width: 1100px) and (min-width: 961px), (max-width: 760px) { .itinerary__columns { grid-template-columns: 1fr; } .itinerary__aside { grid-template-columns: repeat(2, minmax(0, 1fr)); padding-top: 0; } .itinerary__quote { display: none; } }
@media (max-width: 540px) { .itinerary { gap: 21px; } .itinerary__seal { display: none; } .itinerary__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 24px; } .itinerary__stats > div:nth-child(odd) { padding-left: 0; } .itinerary__stats > div:nth-child(even) { border-right: 0; } .itinerary__aside { grid-template-columns: 1fr; } .section-title > span { font-size: 9px; } .day-card__head { padding: 16px; gap: 11px; } .day-card__spots { padding-left: 19px; padding-right: 16px; } .day-card__meta { margin: 0 17px; } .spot__thumb { width: 65px; height: 50px; } .version-item { gap: 9px; flex-wrap: wrap; padding: 10px 0; } .version-item__time { font-size: 9px; } }
</style>

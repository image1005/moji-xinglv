<script setup lang="ts">
import { DaySchema, PlanSchema, SpotSchema, type Plan, type Spot } from '#shared/schemas/plan'
import { hasCoordinates, MAP_PAGE_SIZE, markerLabels, mapViewport, routeDistance, staticMapUrl } from '#shared/utils/routes'
import { apiErrorMessage } from '~/utils/api'

const { currentPlan, savePlan, errorMessage, loading } = useWorkspace()
const dayIndex = ref(0)
const page = ref(0)
const selectedIndex = ref<number | null>(null)
const zoomOffset = ref(0)
const saving = ref(false)
const feedback = ref('')
const failure = ref('')
const busy = computed(() => saving.value || loading.value)
const days = computed(() => currentPlan.value?.plan.days ?? [])
const day = computed(() => days.value[dayIndex.value])
const pageCount = computed(() => Math.max(1, Math.ceil((day.value?.spots.length ?? 0) / MAP_PAGE_SIZE)))
const pageSpots = computed(() => (day.value?.spots ?? []).slice(page.value * MAP_PAGE_SIZE, (page.value + 1) * MAP_PAGE_SIZE)
  .map((spot, index) => ({ spot, index: page.value * MAP_PAGE_SIZE + index })))
const locatedPage = computed(() => pageSpots.value.filter(({ spot }) => hasCoordinates(spot)))
const selectedSpot = computed(() => selectedIndex.value === null ? null : day.value?.spots[selectedIndex.value] ?? null)
const locatedCount = computed(() => day.value?.spots.filter(hasCoordinates).length ?? 0)
const locatedRate = computed(() => day.value?.spots.length ? Math.round(locatedCount.value / day.value.spots.length * 100) : 0)
const distance = computed(() => routeDistance(day.value?.spots ?? []).toFixed(1))
const mappedSpots = computed(() => (selectedSpot.value ? [selectedSpot.value] : pageSpots.value.map(({ spot }) => spot)).filter(hasCoordinates))
const viewport = computed(() => mapViewport(mappedSpots.value))
const zoom = computed(() => Math.max(3, Math.min(18, (viewport.value?.zoom ?? 12) + zoomOffset.value)))
const categories: Record<Spot['category'], string> = { sight: '景点', food: '美食', stay: '住宿', transport: '交通' }

function markerLabel(index: number) {
  const markerIndex = locatedPage.value.findIndex((item) => item.index === index)
  return markerIndex < 0 ? '—' : markerLabels[markerIndex] ?? '—'
}

const url = computed(() => {
  const value = staticMapUrl(mappedSpots.value, zoomOffset.value)
  if (!value || selectedIndex.value === null) return value
  // 聚焦仅保留一个标记，仍沿用清单中的页内编号。
  const params = new URLSearchParams(value.split('?')[1])
  params.set('markerStyles', `m,${markerLabel(selectedIndex.value)},0xA63A2F`)
  return `/api/staticmap?${params.toString()}`
})

type Snapshot = { planId: number; version: number; plan: Plan }
type Editor = Snapshot & { kind: 'spot' | 'day'; dayIndex: number; spotIndex: number | null }
const editor = shallowRef<Editor | null>(null)
const spotForm = reactive({ name: '', time: '', address: '', notes: '', imageUrl: '', category: 'sight' as Spot['category'], lng: '', lat: '', cost: '0', durationMinutes: '60' })
const dayForm = reactive({ date: '', city: '', transport: '', lodging: '', meals: '' })
let scope = 0

function snapshot(): Snapshot | null {
  const current = currentPlan.value
  return current ? { planId: current.id, version: current.version, plan: PlanSchema.parse(current.plan) } : null
}

function clearNotice() {
  feedback.value = ''
  failure.value = ''
}

function openSpot(index: number | null = null) {
  if (busy.value || editor.value || !day.value) return
  const base = snapshot()
  if (!base) return
  const spot = index === null ? null : base.plan.days[dayIndex.value]?.spots[index]
  if (index !== null && !spot) return
  Object.assign(spotForm, {
    name: spot?.name ?? '', time: spot?.time ?? '', address: spot?.address ?? '', notes: spot?.notes ?? '', imageUrl: spot?.imageUrl ?? '',
    category: spot?.category ?? 'sight', lng: spot?.lng == null ? '' : String(spot.lng), lat: spot?.lat == null ? '' : String(spot.lat),
    cost: String(spot?.cost ?? 0), durationMinutes: String(spot?.durationMinutes ?? 60),
  })
  editor.value = { ...base, kind: 'spot', dayIndex: dayIndex.value, spotIndex: index }
  clearNotice()
}

function openDay(isNew: boolean) {
  if (busy.value || editor.value) return
  const base = snapshot()
  if (!base) return
  const index = isNew ? base.plan.days.length : dayIndex.value
  const existing = base.plan.days[index]
  Object.assign(dayForm, {
    date: existing?.date ?? '', city: existing?.city ?? '',
    transport: existing?.transport ?? '', lodging: existing?.lodging ?? '', meals: (existing?.meals ?? []).join('\n'),
  })
  editor.value = { ...base, kind: 'day', dayIndex: index, spotIndex: null }
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

async function submitEditor() {
  const base = editor.value
  if (!base || busy.value) return
  failure.value = ''
  const next = PlanSchema.parse(base.plan)
  if (base.kind === 'spot') {
    const target = next.days[base.dayIndex]
    if (!target) return
    const previous = base.spotIndex === null ? {} : target.spots[base.spotIndex]
    const result = SpotSchema.safeParse({
      ...previous, ...spotForm, name: spotForm.name.trim(), address: spotForm.address.trim(), imageUrl: spotForm.imageUrl.trim(),
      lng: spotForm.lng.trim() === '' ? null : Number(spotForm.lng), lat: spotForm.lat.trim() === '' ? null : Number(spotForm.lat),
      cost: Number(spotForm.cost), durationMinutes: Number(spotForm.durationMinutes),
    })
    if (!result.success) {
      failure.value = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；')
      return
    }
    if (base.spotIndex === null) target.spots.push(result.data)
    else target.spots[base.spotIndex] = result.data
  } else {
    const result = DaySchema.safeParse({
      ...next.days[base.dayIndex], date: dayForm.date, city: dayForm.city.trim(),
      transport: dayForm.transport.trim(), lodging: dayForm.lodging.trim(),
      meals: dayForm.meals.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 20),
    })
    if (!result.success) {
      failure.value = result.error.issues.map((issue) => issue.message).join('；')
      return
    }
    next.days[base.dayIndex] = result.data
  }
  if (await persist(base, next, base.kind === 'spot' ? '地点已保存' : '日程已保存')) {
    if (editor.value !== base) return
    dayIndex.value = base.dayIndex
    page.value = base.kind === 'spot' && base.spotIndex === null
      ? Math.floor(((next.days[base.dayIndex]?.spots.length ?? 1) - 1) / MAP_PAGE_SIZE) : page.value
    editor.value = null
  }
}

async function moveSpot(index: number, direction: -1 | 1) {
  if (busy.value || editor.value) return
  const base = snapshot()
  const spots = base?.plan.days[dayIndex.value]?.spots
  const item = spots?.[index]
  const adjacent = spots?.[index + direction]
  if (!base || !spots || !item || !adjacent) return
  spots[index] = adjacent
  spots[index + direction] = item
  await persist(base, base.plan, '地点顺序已更新')
}

async function removeSpot(index: number) {
  if (busy.value || editor.value) return
  const base = snapshot()
  const spots = base?.plan.days[dayIndex.value]?.spots
  const item = spots?.[index]
  if (!base || !spots || !item || !window.confirm(`从当天行程中删除「${item.name}」？历史版本仍会保留。`)) return
  spots.splice(index, 1)
  await persist(base, base.plan, '地点已删除')
}

function restoreOverview() {
  selectedIndex.value = null
  zoomOffset.value = 0
}

function focusSpot(index: number) {
  selectedIndex.value = selectedIndex.value === index ? null : index
  zoomOffset.value = 0
}

watch([dayIndex, page], restoreOverview)
watch(() => currentPlan.value?.version, () => {
  dayIndex.value = Math.min(dayIndex.value, Math.max(0, days.value.length - 1))
  page.value = Math.min(page.value, pageCount.value - 1)
  restoreOverview()
})
watch(() => currentPlan.value?.id, () => {
  scope++
  editor.value = null
  saving.value = false
  dayIndex.value = 0
  page.value = 0
  restoreOverview()
  clearNotice()
}, { flush: 'sync' })
onBeforeUnmount(() => { scope++ })
</script>

<template>
  <section class="map-view" aria-label="每日路线与地点编辑">
    <header class="map-view__heading">
      <div><span class="map-view__eyebrow">山海有迹 · 一日一程</span><h2>把沿途，落在地图上</h2><p>顺着自己的节奏，串起想去的地方。</p></div>
      <button type="button" class="map-view__seal" :disabled="!currentPlan || busy || !!editor || days.length >= 90" @click="openDay(true)">添一日</button>
    </header>

    <div v-if="!currentPlan" class="map-view__empty"><h3>先展开一本行笺</h3><p>选择或新建工作区，再开始记录沿途地点。</p></div>
    <template v-else>
      <div v-if="days.length" class="map-view__days" aria-label="选择日期">
        <button v-for="(item, i) in days" :key="i" type="button" :class="{ active: dayIndex === i }" :aria-pressed="dayIndex === i" :disabled="busy || !!editor" @click="dayIndex = i; page = 0">
          <span>第 {{ i + 1 }} 日</span><strong>{{ item.city || '城市待定' }}</strong><small>{{ item.date || '日期待定' }}</small>
        </button>
      </div>
      <div v-else-if="!editor" class="map-view__empty"><span class="map-view__empty-mark">行</span><h3>第一程，从留白开始</h3><p>添一日，记下城市与日期；地点和坐标都可以慢慢补齐。</p><button type="button" class="map-view__seal" :disabled="busy" @click="openDay(true)">写下第一日</button></div>

      <template v-if="day">
        <div class="map-view__dayline"><div><strong>第 {{ dayIndex + 1 }} 日 · {{ day.city || '城市待定' }}</strong><span>{{ day.date || '日期待定' }}</span></div><button type="button" class="map-view__text-button" :disabled="busy || !!editor" @click="openDay(false)">编辑日期 / 城市</button></div>
        <div class="map-view__metrics">
          <div><strong>{{ day.spots.length }}</strong><span>沿途地点</span></div>
          <div><strong>{{ locatedRate }}<small>%</small></strong><span>已定位 · {{ locatedCount }}/{{ day.spots.length }}</span></div>
          <div><strong>{{ distance }}<small> km</small></strong><span>相邻已定位点直线估算</span></div>
        </div>
        <div class="map-view__canvas">
          <div class="map-view__mapbar"><span>{{ selectedSpot ? `聚焦 · ${selectedSpot.name}` : `第 ${page + 1} 页 · 地点顺序图` }}</span><div class="map-view__zoom"><button type="button" aria-label="缩小地图" :disabled="!url || zoom <= 3" @click="zoomOffset--">−</button><span>{{ zoom }} 级</span><button type="button" aria-label="放大地图" :disabled="!url || zoom >= 18" @click="zoomOffset++">+</button><button type="button" :disabled="!day.spots.length" @click="restoreOverview">本页全览</button></div></div>
          <div class="map-view__frame">
            <CachedImage v-if="url" :src="url" :alt="`${day.city || '当天'}第${page + 1}页地点静态地图`" />
            <div v-else class="map-view__map-empty"><span>坐标留白，行程照常</span><p>{{ selectedSpot ? '此地点坐标待补全，可在编辑中填写 BD-09 经纬度。' : '本页暂无已定位地点。添加地点时可以暂不填写坐标。' }}</p></div>
          </div>
          <p class="map-view__note">百度官方静态图由服务端代理并缓存，密钥不进入浏览器。缩放会重新取图，不支持拖动；未配置服务或暂无图像时，仍可编辑行程。</p>
        </div>
        <p class="map-view__route-note">标记编号与本页清单对应；连线仅表示本页已定位地点的先后顺序，不是道路导航。直线估算仅累计当天相邻且均已定位的地点，不含缺失坐标的路段。</p>

        <aside v-if="selectedSpot" class="map-view__detail" aria-label="所选地点详情">
          <div class="map-view__detail-title"><h3>{{ selectedSpot.name }}</h3><span>{{ categories[selectedSpot.category] }}</span><button type="button" aria-label="关闭地点详情" @click="restoreOverview">收起</button></div>
          <dl><div><dt>时间</dt><dd>{{ selectedSpot.time || '随心安排' }}</dd></div><div><dt>地址</dt><dd>{{ selectedSpot.address || '地址待补全' }}</dd></div><div><dt>BD-09</dt><dd>{{ hasCoordinates(selectedSpot) ? `${selectedSpot.lng.toFixed(6)}, ${selectedSpot.lat.toFixed(6)}` : '坐标待补全' }}</dd></div><div><dt>停留 / 花费</dt><dd>{{ selectedSpot.durationMinutes }} 分钟 · {{ currentPlan.plan.budget.currency }} {{ selectedSpot.cost }}</dd></div></dl>
          <p v-if="selectedSpot.notes">{{ selectedSpot.notes }}</p>
        </aside>

        <div class="map-view__list-heading"><h3>沿途清单 <small>按当天行走顺序排列</small></h3><button type="button" class="map-view__seal" :disabled="busy || !!editor || day.spots.length >= 50" @click="openSpot()">添一处</button></div>
        <ol v-if="pageSpots.length" class="map-view__spots">
          <li v-for="item in pageSpots" :key="item.index" :class="{ selected: selectedIndex === item.index }">
            <button type="button" class="map-view__spot" :aria-pressed="selectedIndex === item.index" @click="focusSpot(item.index)">
              <span class="map-view__marker" :class="{ 'is-unknown': !hasCoordinates(item.spot) }">{{ markerLabel(item.index) }}</span>
              <span class="map-view__spot-copy"><span class="map-view__spot-name"><strong>{{ item.spot.name }}</strong><small>{{ categories[item.spot.category] }}</small></span><span>{{ item.spot.time || '时间待定' }} · {{ item.spot.address || '地址待补全' }}</span><small v-if="!hasCoordinates(item.spot)" class="map-view__unknown">坐标待补全 · 不计入地图标记</small></span>
              <span class="map-view__order">{{ String(item.index + 1).padStart(2, '0') }}</span>
            </button>
            <div class="map-view__spot-actions"><button type="button" :disabled="busy || !!editor || item.index === 0" :aria-label="`上移${item.spot.name}`" @click="moveSpot(item.index, -1)">上移</button><button type="button" :disabled="busy || !!editor || item.index === day.spots.length - 1" :aria-label="`下移${item.spot.name}`" @click="moveSpot(item.index, 1)">下移</button><button type="button" :disabled="busy || !!editor" :aria-label="`编辑${item.spot.name}`" @click="openSpot(item.index)">编辑</button><button type="button" class="map-view__danger" :disabled="busy || !!editor" :aria-label="`删除${item.spot.name}`" @click="removeSpot(item.index)">删除</button></div>
          </li>
        </ol>
        <div v-else class="map-view__empty map-view__empty--small"><p>今日还没有地点。记一处风景、一餐美食，或今晚的落脚处。</p></div>
        <nav v-if="pageCount > 1" class="map-view__pagination" aria-label="当天地点分页"><button type="button" :disabled="page === 0 || busy || !!editor" @click="page--">上一页</button><span>{{ page + 1 }} / {{ pageCount }} · 每页至多 {{ MAP_PAGE_SIZE }} 处</span><button type="button" :disabled="page + 1 >= pageCount || busy || !!editor" @click="page++">下一页</button></nav>
      </template>

      <form v-if="editor" class="map-view__editor" @submit.prevent="submitEditor">
        <div class="map-view__editor-title"><h3>{{ editor.kind === 'day' ? '记下一日' : editor.spotIndex === null ? '添一处沿途风景' : '编辑地点' }}</h3><span>基于 v{{ editor.version }}</span></div>
        <p v-if="currentPlan.version !== editor.version" class="map-view__warning">行笺已有新版本。本草稿不会覆盖它；请取消并重新打开编辑，或保留内容后再处理。</p>
        <fieldset :disabled="busy">
          <template v-if="editor.kind === 'day'">
            <label>日期<input v-model="dayForm.date" type="date" ></label>
            <label>城市<input v-model="dayForm.city" maxlength="200" placeholder="例如：杭州" ></label>
            <label class="map-view__wide">交通<textarea v-model="dayForm.transport" rows="2" maxlength="4000" placeholder="例如：地铁 1 号线 → 公交 7 路；也可留空" /></label>
            <label class="map-view__wide">住宿<textarea v-model="dayForm.lodging" rows="2" maxlength="4000" placeholder="例如：湖滨一带民宿，或当晚落脚处" /></label>
            <label class="map-view__wide">用餐<textarea v-model="dayForm.meals" rows="2" placeholder="每行一条，例如：知味观（午餐）" /></label>
          </template>
          <template v-else>
            <label class="map-view__wide">地点名称 <span>必填</span><input v-model="spotForm.name" required maxlength="200" placeholder="写下想去的地方" ></label>
            <label>类型<select v-model="spotForm.category"><option v-for="(label, key) in categories" :key="key" :value="key">{{ label }}</option></select></label>
            <label>时间<input v-model="spotForm.time" maxlength="80" placeholder="例如：09:30 或午后" ></label>
            <label class="map-view__wide">地址<input v-model="spotForm.address" maxlength="500" placeholder="可以稍后补充详细地址" ></label>
            <label class="map-view__wide">图片地址<input v-model="spotForm.imageUrl" type="url" maxlength="2048" placeholder="https://… 或本站地图代理地址，可留空" ></label>
            <label>经度 · BD-09<input v-model="spotForm.lng" type="number" step="any" min="-180" max="180" placeholder="未知请留空" ></label>
            <label>纬度 · BD-09<input v-model="spotForm.lat" type="number" step="any" min="-90" max="90" placeholder="未知请留空" ></label>
            <p class="map-view__field-note map-view__wide">经纬度须同时填写或同时留空；不自动搜索地点，不推测坐标。</p>
            <label>停留时长 / 分钟<input v-model="spotForm.durationMinutes" type="number" required min="0" max="1440" step="1" ></label>
            <label>预计花费 / {{ editor.plan.budget.currency }}<input v-model="spotForm.cost" type="number" required min="0" max="10000000" step="any" ></label>
            <label class="map-view__wide">随手记<textarea v-model="spotForm.notes" rows="3" maxlength="4000" placeholder="预约、开门时间，或值得期待的小事" /></label>
          </template>
        </fieldset>
        <div class="map-view__editor-actions"><button type="button" :disabled="busy" @click="editor = null; failure = ''">取消</button><button type="submit" class="map-view__seal" :disabled="busy">{{ saving ? '正在落笔…' : '保存为新版本' }}</button></div>
      </form>
      <p v-if="failure" class="map-view__failure" role="alert">{{ failure }}</p>
      <p v-if="feedback" class="map-view__feedback" role="status">{{ feedback }}</p>
    </template>
  </section>
</template>

<style scoped>
.map-view { display: grid; gap: 20px; color: var(--ink); }
.map-view button, .map-view input, .map-view select, .map-view textarea { font: inherit; }
.map-view button { cursor: pointer; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); color: var(--ink-soft); padding: 7px 12px; font-size: 12px; transition: background .18s, border-color .18s; }
.map-view button:hover:not(:disabled) { border-color: var(--gold, #b89557); background: var(--paper-deep); }
.map-view button:disabled { opacity: .4; cursor: not-allowed; }
.map-view button:focus-visible, .map-view input:focus-visible, .map-view select:focus-visible, .map-view textarea:focus-visible { outline: 2px solid var(--gold, #b89557); outline-offset: 3px; }
.map-view h2, .map-view h3 { font-family: var(--font-serif, 'Noto Serif SC', 'Songti SC', SimSun, serif); font-weight: 600; margin: 0; }
.map-view__heading { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
.map-view__eyebrow { color: var(--gold, #9b7b43); font-size: 11px; letter-spacing: .16em; }
.map-view h2 { font-size: 25px; letter-spacing: .04em; margin-top: 9px; }
.map-view__heading p { font-size: 12px; color: var(--ink-faint); margin: 9px 0 0; }
.map-view .map-view__seal { background: var(--cinnabar, #a63a2f); color: #fff9ef; border: 1px solid var(--cinnabar, #a63a2f); box-shadow: inset 0 0 0 2px var(--paper, #f8f4eb); padding: 10px 17px; letter-spacing: .08em; flex-shrink: 0; }
.map-view .map-view__seal:hover:not(:disabled) { background: #88362d; border-color: #88362d; }
.map-view__days { display: flex; gap: 9px; overflow-x: auto; padding: 2px 1px 6px; }
.map-view__days button { display: grid; text-align: left; gap: 5px; min-width: 122px; padding: 12px 17px; border-top: 2px solid transparent; }
.map-view__days button.active { border-color: var(--gold, #b89557); background: var(--paper-deep); }
.map-view__days span, .map-view__days small { font-size: 10px; color: var(--ink-faint); }
.map-view__days strong { font-size: 14px; color: var(--ink); font-weight: 500; }
.map-view__dayline, .map-view__dayline > div { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.map-view__dayline { justify-content: space-between; font-size: 14px; }
.map-view__dayline span { font-size: 12px; color: var(--ink-faint); }
.map-view .map-view__text-button { border: 0; background: transparent; padding: 4px 0; }
.map-view__metrics { display: grid; grid-template-columns: repeat(3, 1fr); padding: 16px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.map-view__metrics > div { display: grid; gap: 7px; padding: 0 18px; border-right: 1px solid var(--line); }
.map-view__metrics > div:first-child { padding-left: 0; }.map-view__metrics > div:last-child { border-right: 0; }
.map-view__metrics strong { font-family: var(--font-serif, Georgia, serif); font-size: 29px; font-weight: 400; font-variant-numeric: tabular-nums; }
.map-view__metrics strong small { font: 12px sans-serif; color: var(--ink-faint); }
.map-view__metrics span { color: var(--ink-faint); font-size: 11px; }
.map-view__canvas { border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: var(--paper); }
.map-view__mapbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 14px; font-size: 12px; color: var(--ink-soft); flex-wrap: wrap; }
.map-view__mapbar > span { overflow-wrap: anywhere; }
.map-view__zoom { display: flex; gap: 6px; align-items: center; }.map-view__zoom > span { color: var(--ink-faint); font-size: 10px; padding: 0 3px; }.map-view__zoom button { padding: 4px 10px; }
.map-view__frame { aspect-ratio: 800 / 480; background: var(--paper-deep); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.map-view__map-empty { height: 100%; display: flex; align-items: center; justify-content: center; flex-direction: column; padding: 24px; text-align: center; box-sizing: border-box; }
.map-view__map-empty > span { font: 20px var(--font-serif, SimSun, serif); letter-spacing: .12em; color: var(--ink-soft); }
.map-view__map-empty p { max-width: 310px; font-size: 12px; line-height: 1.9; color: var(--ink-faint); }
.map-view__note { margin: 0; padding: 12px 15px; font-size: 10px; color: var(--ink-faint); line-height: 1.8; }
.map-view__route-note { margin: -8px 0 0; color: var(--ink-faint); font-size: 11px; line-height: 1.8; }
.map-view__detail { border-left: 2px solid var(--gold, #b89557); background: var(--paper-deep); padding: 18px 22px; }
.map-view__detail-title { display: flex; gap: 10px; align-items: center; }.map-view__detail-title h3 { font-size: 19px; overflow-wrap: anywhere; }.map-view__detail-title > span { font-size: 10px; color: var(--ink-faint); flex-shrink: 0; }.map-view__detail-title button { margin-left: auto; flex-shrink: 0; }
.map-view__detail dl { display: grid; gap: 10px; margin: 16px 0 0; }.map-view__detail dl > div { display: flex; gap: 14px; font-size: 12px; }.map-view__detail dt { color: var(--ink-faint); min-width: 72px; }.map-view__detail dd { margin: 0; overflow-wrap: anywhere; }.map-view__detail > p { margin: 15px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.8; color: var(--ink-soft); }
.map-view__list-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.map-view__list-heading h3 { font-size: 19px; }.map-view__list-heading small { font: 11px sans-serif; color: var(--ink-faint); margin-left: 10px; }
.map-view__spots { list-style: none; padding: 0; margin: -6px 0 0; display: grid; gap: 10px; }.map-view__spots > li { border: 1px solid var(--line); background: var(--paper); border-radius: 5px; overflow: hidden; }.map-view__spots > li.selected { border-color: var(--gold, #b89557); }
.map-view .map-view__spot { display: flex; width: 100%; text-align: left; align-items: center; gap: 14px; padding: 16px; border: 0; background: transparent; }.map-view__marker { display: grid; place-items: center; width: 29px; height: 32px; border: 1px solid var(--cinnabar, #a63a2f); color: var(--cinnabar, #a63a2f); font: 17px Georgia, serif; border-radius: 3px 3px 10px 10px; flex-shrink: 0; }.map-view__marker.is-unknown { border-color: var(--line); color: var(--ink-faint); }.map-view__spot-copy { display: grid; gap: 6px; flex: 1; min-width: 0; }.map-view__spot-copy > span:not(:first-child) { color: var(--ink-faint); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }.map-view__spot-name { display: flex; gap: 9px; align-items: center; flex-wrap: wrap; }.map-view__spot-name strong { font-size: 14px; font-weight: 500; color: var(--ink); overflow-wrap: anywhere; }.map-view__spot-name small { font-size: 10px; background: var(--paper-deep); color: var(--ink-faint); padding: 2px 6px; }.map-view__unknown { color: #947438; font-size: 10px; }.map-view__order { font: 23px Georgia, serif; color: var(--line); flex-shrink: 0; }
.map-view__spot-actions { display: flex; gap: 14px; justify-content: flex-end; border-top: 1px solid var(--line); padding: 7px 15px; }.map-view__spot-actions button { border: 0; padding: 3px 2px; background: transparent; font-size: 11px; }.map-view .map-view__danger { color: var(--cinnabar, #a63a2f); }
.map-view__pagination { display: flex; gap: 14px; align-items: center; justify-content: center; font-size: 11px; color: var(--ink-faint); }
.map-view__empty { text-align: center; padding: 52px 24px; border: 1px dashed var(--line); }.map-view__empty h3 { font-size: 22px; }.map-view__empty p { color: var(--ink-faint); font-size: 12px; line-height: 1.9; margin: 12px 0 20px; }.map-view__empty-mark { display: inline-block; font: 31px var(--font-serif, SimSun, serif); border: 1px solid var(--gold, #b89557); padding: 7px 11px; color: var(--gold, #b89557); margin-bottom: 22px; }.map-view__empty--small { padding: 18px; }.map-view__empty--small p { margin: 0; }
.map-view__editor { background: var(--paper); border: 1px solid var(--gold, #b89557); border-radius: 5px; padding: 23px; }.map-view__editor-title { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 20px; }.map-view__editor-title h3 { font-size: 21px; }.map-view__editor-title > span { color: var(--ink-faint); font-size: 11px; }.map-view__editor fieldset { border: 0; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }.map-view__editor label { display: grid; gap: 7px; font-size: 12px; color: var(--ink-soft); }.map-view__editor label > span { color: var(--cinnabar, #a63a2f); font-size: 10px; }.map-view__editor input, .map-view__editor select, .map-view__editor textarea { border: 1px solid var(--line); background: var(--paper-warm, #fcfaf5); border-radius: 3px; padding: 10px 11px; min-width: 0; width: 100%; box-sizing: border-box; color: var(--ink); font-size: 13px; }.map-view__editor textarea { resize: vertical; }.map-view__wide { grid-column: 1 / -1; }.map-view__field-note { margin: -8px 0 0; font-size: 11px; color: var(--ink-faint); line-height: 1.7; }.map-view__editor-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
.map-view__failure, .map-view__feedback, .map-view__warning { padding: 12px 15px; margin: 0; font-size: 12px; line-height: 1.8; border-radius: 4px; overflow-wrap: anywhere; }.map-view__failure, .map-view__warning { background: #a63a2f0b; color: var(--cinnabar, #a63a2f); border: 1px solid #a63a2f25; }.map-view__feedback { background: #4a72640c; color: var(--bamboo, #4a7264); border: 1px solid #4a726425; }.map-view__warning { margin-bottom: 17px; }
@media (max-width: 620px) { .map-view h2 { font-size: 21px; }.map-view__metrics > div { padding: 0 10px; }.map-view__metrics strong { font-size: 24px; }.map-view__metrics span { font-size: 10px; }.map-view__frame { aspect-ratio: auto; height: 280px; }.map-view__frame :deep(.cached-image) { object-fit: contain; }.map-view__list-heading small { display: block; margin: 5px 0 0; }.map-view__editor { padding: 17px; }.map-view__editor fieldset { grid-template-columns: 1fr; }.map-view__spot-actions { gap: 20px; }.map-view__detail { padding: 16px; } }
</style>

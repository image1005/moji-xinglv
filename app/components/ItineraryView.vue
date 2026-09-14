<script setup lang="ts">
const { currentPlan, versions, updatePlanMeta, rollback } = useWorkspace()

const editing = ref(false)
const busy = ref(false)
const form = reactive({ title: '', summary: '', contentMd: '' })

watch(
  () => currentPlan.value?.id,
  () => {
    editing.value = false
    if (currentPlan.value) {
      form.title = currentPlan.value.title
      form.summary = currentPlan.value.summary
      form.contentMd = currentPlan.value.contentMd
    }
  },
  { immediate: true },
)

async function saveMeta() {
  if (busy.value) return
  busy.value = true
  try {
    await updatePlanMeta({ title: form.title, summary: form.summary, contentMd: form.contentMd })
    editing.value = false
  } finally {
    busy.value = false
  }
}

async function doRollback(version: number) {
  if (!window.confirm(`回滚到 v${version}？将基于该版本新建一个版本，历史保留。`)) return
  await rollback(version)
}
</script>

<template>
  <div v-if="currentPlan" class="itinerary">
    <section class="itinerary__head">
      <h3>{{ currentPlan.plan.title }}</h3>
      <p v-if="currentPlan.plan.summary">{{ currentPlan.plan.summary }}</p>
      <div class="itinerary__row">
        <span v-for="tag in currentPlan.plan.tags" :key="tag" class="itinerary__tag">{{ tag }}</span>
        <button class="btn btn--ghost btn--small" @click="editing = !editing">
          {{ editing ? '收起' : '编辑资料' }}
        </button>
      </div>
    </section>

    <section v-if="editing" class="itinerary__edit">
      <label>标题<input v-model="form.title" type="text" ></label>
      <label>简介<textarea v-model="form.summary" rows="2" /></label>
      <label>Markdown 内容<textarea v-model="form.contentMd" rows="6" /></label>
      <button class="btn btn--seal" :disabled="busy" @click="saveMeta">保存资料</button>
    </section>
    <section v-for="(day, index) in currentPlan.plan.days" :key="index" class="day-card">
      <header class="day-card__head">
        <span class="day-card__index">第 {{ index + 1 }} 天</span>
        <span class="day-card__date">{{ day.date }}</span>
        <span v-if="day.city" class="day-card__city">{{ day.city }}</span>
      </header>
      <ul class="day-card__spots">
        <li v-for="(spot, spotIndex) in day.spots" :key="spotIndex" class="spot">
          <div class="spot__info">
            <span v-if="spot.time" class="spot__time">{{ spot.time }}</span>
            <span class="spot__name">{{ spot.name }}</span>
            <p v-if="spot.notes" class="spot__notes">{{ spot.notes }}</p>
          </div>
          <div v-if="spot.panorama.startsWith('/api/panorama')" class="spot__thumb">
            <CachedImage :src="spot.panorama" :alt="`${spot.name} 街景`" />
          </div>
        </li>
      </ul>
      <dl class="day-card__meta">
        <div v-if="day.transport"><dt>交通</dt><dd>{{ day.transport }}</dd></div>
        <div v-if="day.lodging"><dt>住宿</dt><dd>{{ day.lodging }}</dd></div>
        <div v-if="day.meals.length"><dt>用餐</dt><dd>{{ day.meals.join(' · ') }}</dd></div>
      </dl>
    </section>

    <section v-if="currentPlan.plan.tips.length" class="itinerary__block">
      <h4>行前贴士</h4>
      <ul class="itinerary__tips">
        <li v-for="(tip, index) in currentPlan.plan.tips" :key="index">{{ tip }}</li>
      </ul>
    </section>

    <section class="itinerary__block">
      <h4>预算</h4>
      <p class="itinerary__budget">
        {{ currentPlan.plan.budget.total }} {{ currentPlan.plan.budget.currency }}
      </p>
      <ul v-if="currentPlan.plan.budget.breakdown" class="itinerary__breakdown">
        <li v-for="(value, key) in currentPlan.plan.budget.breakdown" :key="key">
          <span>{{ key }}</span><span>{{ value }}</span>
        </li>
      </ul>
    </section>

    <section v-if="currentPlan.contentMd" class="itinerary__block">
      <h4>规划手记</h4>
      <MDC :value="currentPlan.contentMd" />
    </section>

    <section class="itinerary__block">
      <h4>版本历史</h4>
      <ul class="version-list">
        <li v-for="version in versions.slice(0, 10)" :key="version.id" class="version-item">
          <span class="version-item__tag">v{{ version.version }}</span>
          <span class="version-item__source">{{ sourceLabel(version.source) }}</span>
          <span class="version-item__time">{{ formatDateTime(version.createdAt) }}</span>
          <button
            v-if="version.version < (currentPlan?.version ?? 0)"
            class="btn btn--ghost btn--small"
            @click="doRollback(version.version)"
          >
            回滚
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.itinerary {
  display: grid;
  gap: 16px;
  font-size: 13px;
}
.itinerary__head h3 {
  margin: 0 0 4px;
  font-family: var(--font-serif);
  font-size: 18px;
  color: var(--ink);
}
.itinerary__head p {
  margin: 0 0 8px;
  color: var(--ink-soft);
}
.itinerary__row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.itinerary__tag {
  font-size: 11px;
  color: var(--bamboo);
  border: 1px solid var(--bamboo);
  border-radius: 3px;
  padding: 1px 6px;
}
.itinerary__row .btn {
  margin-left: auto;
}
.itinerary__edit {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px dashed var(--line);
  border-radius: 4px;
  background: var(--paper);
}
.itinerary__edit label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--ink-soft);
}
.itinerary__edit input,
.itinerary__edit textarea {
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
  background: var(--paper-deep);
}
.itinerary__edit .btn {
  justify-self: start;
}
.day-card {
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--paper);
}
.day-card__head {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line-soft);
}
.day-card__index {
  font-family: var(--font-serif);
  color: var(--cinnabar);
}
.day-card__date {
  font-size: 12px;
  color: var(--ink-faint);
}
.day-card__city {
  margin-left: auto;
  color: var(--bamboo);
  font-size: 12px;
}
.day-card__spots {
  list-style: none;
  margin: 0;
  padding: 6px 12px;
}
.spot {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px dashed var(--line-soft);
}
.spot:last-child {
  border-bottom: none;
}
.spot__info {
  flex: 1;
  min-width: 0;
}
.spot__time {
  font-family: var(--font-serif);
  color: var(--gold-deep);
  font-size: 12px;
  margin-right: 6px;
}
.spot__name {
  color: var(--ink);
}
.spot__notes {
  margin: 3px 0 0;
  color: var(--ink-faint);
  font-size: 12px;
}
.spot__thumb {
  width: 84px;
  height: 50px;
  border-radius: 3px;
  overflow: hidden;
  border: 1px solid var(--line);
  flex-shrink: 0;
}
.day-card__meta {
  margin: 0;
  padding: 8px 12px 10px;
  display: grid;
  gap: 4px;
  border-top: 1px solid var(--line-soft);
}
.day-card__meta div {
  display: flex;
  gap: 8px;
}
.day-card__meta dt {
  color: var(--ink-faint);
  font-size: 12px;
  flex-shrink: 0;
}
.day-card__meta dd {
  margin: 0;
  color: var(--ink-soft);
  font-size: 12px;
}
.itinerary__block h4 {
  margin: 0 0 6px;
  font-family: var(--font-serif);
  font-size: 14px;
  color: var(--ink-soft);
  letter-spacing: 0.15em;
}
.itinerary__tips {
  margin: 0;
  padding-left: 18px;
  color: var(--ink-soft);
  display: grid;
  gap: 4px;
}
.itinerary__budget {
  font-family: var(--font-serif);
  font-size: 20px;
  color: var(--cinnabar);
  margin: 0 0 6px;
}
.itinerary__breakdown {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 3px;
}
.itinerary__breakdown li {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px dashed var(--line-soft);
  padding-bottom: 3px;
  color: var(--ink-soft);
}
.version-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.version-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-soft);
}
.version-item__tag {
  font-family: var(--font-serif);
  color: var(--gold-deep);
}
.version-item__time {
  color: var(--ink-faint);
  margin-left: auto;
}
</style>

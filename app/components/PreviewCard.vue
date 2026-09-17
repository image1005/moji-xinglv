<script setup lang="ts">
import type { PlanPreview } from '#shared/types'
import { api, apiErrorMessage } from '~/utils/api'
import { sourceLabel } from '~/utils/format'

const props = defineProps<{ preview: PlanPreview }>()

const ws = useWorkspace()
const busy = ref(false)
const copied = ref(false)
const showDiff = ref(false)
const expanded = ref(false)
const loadingDiff = ref(false)
const failure = ref('')
const samePlan = computed(() => ws.currentPlan.value?.id === props.preview.planId)
const currentPlanVersion = computed(() => (samePlan.value ? ws.currentPlan.value?.version : undefined))
const diff = computed(() => samePlan.value ? ws.versions.value.find((v) => v.version === props.preview.version)?.diffJson ?? [] : [])
const diffLoaded = computed(() => ws.versions.value.some((v) => v.version === props.preview.version))
async function toggleDiff() {
  showDiff.value = !showDiff.value
  if (!showDiff.value || !samePlan.value || diffLoaded.value) return
  loadingDiff.value = true
  try {
    await ws.loadVersions()
    while (!diffLoaded.value && ws.versionsHasMore.value && samePlan.value && !ws.loadingVersions.value && !ws.offline.value) {
      if (await ws.loadVersions(true) !== true) break
    }
  } finally { loadingDiff.value = false }
}

const panoramas = computed(() => {
  const spots = props.preview.days
    .flatMap((d) => d.spots)
    .filter((s) => s.panorama.startsWith('/api/panorama'))
    .slice(0, 3)
  return spots
})

function show(value: unknown): string {
  const text = JSON.stringify(value)
  if (text === undefined) return '（无）'
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

async function copyJson() {
  try {
    const { plan } = await api.plans.versionPlan(props.preview.planId, props.preview.version)
    await navigator.clipboard.writeText(JSON.stringify(plan, null, 2))
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch (error) {
    failure.value = apiErrorMessage(error, '复制失败，请检查剪贴板权限')
  }
}

async function undo() {
  if (busy.value || !samePlan.value || props.preview.version === ws.currentPlan.value?.version) return
  if (!window.confirm(`切换到 v${props.preview.version}？当前版本将变为 v${props.preview.version}，历史版本仍保留。`)) return
  busy.value = true
  try {
    await ws.switchVersion(props.preview.version)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="preview-card">
    <div class="preview-card__head">
      <span class="preview-card__badge">v{{ preview.version }}</span>
      <span class="preview-card__title">{{ preview.title || '未命名行程' }}</span>
      <span class="preview-card__source">{{ sourceLabel(preview.source) }}</span>
    </div>
    <p v-if="preview.summary" class="preview-card__summary">{{ preview.summary }}</p>
    <button v-if="preview.days.length" class="preview-card__action" :aria-expanded="expanded" @click="expanded = !expanded">{{ preview.days.length }} 天行程 · {{ expanded ? '收起安排' : '展开安排' }}</button>
    <ul v-if="expanded && preview.days.length" class="preview-card__days">
      <li v-for="(day, index) in preview.days" :key="index">
        <span class="preview-card__date">{{ day.date || `第 ${index + 1} 天` }}</span>
        <span v-if="day.city" class="preview-card__city">{{ day.city }}</span>
        <span class="preview-card__spots">{{ day.spots.map((s) => s.name).join(' · ') || '自由活动' }}</span>
      </li>
    </ul>
    <div v-if="expanded && panoramas.length" class="preview-card__panoramas">
      <div v-for="(spot, index) in panoramas" :key="index" class="preview-card__thumb" :title="spot.name">
        <CachedImage :src="spot.panorama" :alt="`${spot.name} 街景`" />
      </div>
    </div>
    <p v-if="preview.message" class="preview-card__note">{{ preview.message }}</p>
    <div class="preview-card__actions">
      <button class="preview-card__action" @click="copyJson">{{ copied ? '已复制' : '复制 JSON' }}</button>
      <button class="preview-card__action" :disabled="loadingDiff || !samePlan || ws.offline.value" @click="toggleDiff">{{ loadingDiff ? '读取变更…' : diffLoaded ? `变更 ${diff.length} 处` : '查看变更' }}</button>
      <button class="preview-card__action" :disabled="busy || !samePlan || preview.version === currentPlanVersion" @click="undo">切换到此版本</button>
      <button class="preview-card__action preview-card__action--seal" :disabled="!samePlan || busy" @click="ws.savePlan()">保存当前规划</button>
    </div>
    <p v-if="failure" class="feedback" role="alert">{{ failure }}</p>
    <ul v-if="showDiff" class="preview-card__diff">
      <li v-if="loadingDiff">正在读取历史变更…</li>
      <li v-else-if="!diffLoaded">尚未取得该版本的变更信息，请重新打开所属行程后查看。</li>
      <li v-else-if="!diff.length">与上一版本相比无差异</li>
      <li v-for="(entry, index) in diff.slice(0, 12)" :key="index">
        <code>{{ entry.path }}</code>
        <span v-if="entry.kind !== 'add'">{{ show(entry.before) }} →</span>
        <span v-if="entry.kind !== 'remove'"> {{ show(entry.after) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.preview-card {
  margin-top: 10px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--cinnabar);
  border-radius: 4px;
  background: var(--paper);
  padding: 12px 14px;
  max-width: 560px;
}
.preview-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.preview-card__badge {
  font-family: var(--font-serif);
  font-size: 12px;
  color: var(--paper);
  background: var(--cinnabar);
  padding: 1px 7px;
  border-radius: 3px;
}
.preview-card__title {
  font-family: var(--font-serif);
  font-weight: 600;
  color: var(--ink);
}
.preview-card__source {
  font-size: 12px;
  color: var(--ink-faint);
  margin-left: auto;
}
.preview-card__summary {
  font-size: 13px;
  color: var(--ink-soft);
  margin: 0 0 8px;
}
.preview-card__days {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: grid;
  gap: 4px;
  font-size: 13px;
}
.preview-card__days li {
  display: flex;
  gap: 8px;
  border-bottom: 1px dashed var(--line-soft);
  padding-bottom: 4px;
}
.preview-card__date {
  font-family: var(--font-serif);
  color: var(--gold-deep);
  white-space: nowrap;
}
.preview-card__city {
  color: var(--bamboo);
  white-space: nowrap;
}
.preview-card__spots {
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview-card__panoramas {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.preview-card__thumb {
  width: 96px;
  height: 56px;
  border: 1px solid var(--line);
  border-radius: 3px;
  overflow: hidden;
}
.preview-card__note {
  font-size: 12px;
  color: var(--ink-faint);
  margin: 0 0 8px;
}
.preview-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.preview-card__action {
  font-size: 12px;
  padding: 3px 10px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--paper-deep);
  color: var(--ink-soft);
  cursor: pointer;
}
.preview-card__action:hover {
  border-color: var(--cinnabar);
  color: var(--cinnabar);
}
.preview-card__action--seal {
  background: var(--cinnabar);
  border-color: var(--cinnabar);
  color: var(--paper);
}
.preview-card__action--seal:hover {
  color: var(--paper);
  opacity: 0.9;
}
.preview-card__diff {
  list-style: none;
  margin: 8px 0 0;
  padding: 8px;
  background: var(--paper-deep);
  border-radius: 3px;
  font-size: 12px;
  color: var(--ink-soft);
  display: grid;
  gap: 4px;
  max-height: 220px;
  overflow: auto;
}
.preview-card__diff code {
  color: var(--bamboo);
  margin-right: 6px;
}
</style>

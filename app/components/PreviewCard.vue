<script setup lang="ts">
import type { PlanPreview } from '#shared/types'
import { api, apiErrorMessage } from '~/utils/api'
import { sourceLabel } from '~/utils/format'

const props = defineProps<{ preview: PlanPreview }>()

const ws = useWorkspace()
const busy = ref(false)
const copied = ref(false)
const showDiff = ref(false)
const expanded = ref(true)
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

    <button
      v-if="preview.days.length"
      class="preview-card__toggle-btn"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span>{{ preview.days.length }} 天行程规划</span>
      <span class="preview-card__toggle-hint">{{ expanded ? '收起安排' : '查看每日安排' }}</span>
      <AppIcon name="chevron" :size="11" class="chevron-rotator" :class="{ rotated: expanded }" />
    </button>

    <!-- 0-JS 平滑展开每日安排 -->
    <div class="collapse-shell" :class="{ collapsed: !expanded }">
      <div class="collapse-inner">
        <ul v-if="preview.days.length" class="preview-card__days">
          <li v-for="(day, index) in preview.days" :key="index">
            <span class="preview-card__date">{{ day.date || `第 ${index + 1} 天` }}</span>
            <span v-if="day.city" class="preview-card__city">{{ day.city }}</span>
            <span class="preview-card__spots">{{ day.spots.map((s) => s.name).join(' · ') || '自由活动' }}</span>
          </li>
        </ul>

        <div v-if="panoramas.length" class="preview-card__panoramas">
          <div v-for="(spot, index) in panoramas" :key="index" class="preview-card__thumb" :title="spot.name">
            <CachedImage :src="spot.panorama" :alt="`${spot.name} 街景`" />
          </div>
        </div>
        <p v-if="preview.foodJournal?.length" class="preview-card__note">风物食记：{{ preview.foodJournal.map(item => item.name).join(' · ') }}</p>
        <PlanMediaGallery v-if="expanded && samePlan && ws.currentPlan.value && preview.version === currentPlanVersion" :plan-id="preview.planId" :revision="ws.currentPlan.value.revision" :plan="ws.currentPlan.value.plan" compact />
      </div>
    </div>

    <p v-if="preview.message" class="preview-card__note">{{ preview.message }}</p>

    <div class="preview-card__actions">
      <button class="preview-card__action" @click="copyJson">{{ copied ? '已复制' : '复制 JSON' }}</button>
      <button class="preview-card__action" @click="ws.openPlanView(preview.planId)">打开图文行程与地图</button>
      <button class="preview-card__action" :disabled="loadingDiff || !samePlan || ws.offline.value" @click="toggleDiff">
        {{ loadingDiff ? '读取变更…' : diffLoaded ? `变更 ${diff.length} 处` : '查看变更' }}
      </button>
      <button class="preview-card__action" :disabled="busy || !samePlan || preview.version === currentPlanVersion" @click="undo">
        切换到此版本
      </button>
      <button class="preview-card__action preview-card__action--seal" :disabled="!samePlan || busy" @click="ws.savePlan()">
        保存当前规划
      </button>
    </div>

    <p v-if="failure" class="feedback" role="alert">{{ failure }}</p>

    <!-- 变更明细折叠 -->
    <div class="collapse-shell" :class="{ collapsed: !showDiff }">
      <div class="collapse-inner">
        <ul class="preview-card__diff">
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
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use "~/assets/styles/variables" as *;

.preview-card {
  margin-top: 12px;
  border: 1px solid var(--border-primary);
  border-left: 3px solid var(--cinnabar);
  border-radius: 10px;
  background: var(--bg-card);
  padding: 14px 16px;
  max-width: 600px;
  box-shadow: var(--shadow-card);
  animation: rise-in $dur-slow $ease-ink both;
  transition: border-color $dur-fast $ease-soft, box-shadow $dur-fast $ease-soft;

  &:hover {
    box-shadow: var(--shadow-float);
  }
}

.preview-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.preview-card__badge {
  font-family: var(--font-serif);
  font-size: 11.5px;
  font-weight: 600;
  color: #ffffff;
  background: var(--cinnabar);
  padding: 1px 8px;
  border-radius: 4px;
  box-shadow: 0 2px 6px var(--accent-red-subtle);
}

.preview-card__title {
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: 15px;
  color: var(--text-primary);
}

.preview-card__source {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-left: auto;
}

.preview-card__summary {
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 10px;
}

.preview-card__toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  border: 1px dashed var(--border-primary);
  border-radius: 6px;
  background: var(--bg-card-muted);
  color: var(--text-primary);
  font-size: 12.5px;
  cursor: pointer;
  margin-bottom: 8px;
  transition: all $dur-fast $ease-soft;

  &:hover {
    border-color: var(--bamboo);
    color: var(--bamboo);
  }

  .preview-card__toggle-hint {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-muted);
  }
}

.preview-card__days {
  list-style: none;
  margin: 4px 0 10px;
  padding: 0;
  display: grid;
  gap: 6px;
  font-size: 13px;

  li {
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px dashed var(--border-secondary);
    padding-bottom: 5px;
  }
}

.preview-card__date {
  font-family: var(--font-serif);
  color: var(--gold-deep);
  font-weight: 500;
  white-space: nowrap;
}

.preview-card__city {
  color: var(--bamboo);
  font-weight: 500;
  white-space: nowrap;
}

.preview-card__spots {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-card__panoramas {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}

.preview-card__thumb {
  width: 100px;
  height: 60px;
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  transition: transform $dur-base $ease-spring;

  &:hover {
    transform: scale(1.05);
  }
}

.preview-card__note {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0 0 10px;
}

.preview-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 4px;
}

.preview-card__action {
  font-size: 12px;
  padding: 5px 12px;
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  background: var(--bg-card-muted);
  color: var(--text-secondary);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: all $dur-fast $ease-soft;

  &:hover:not(:disabled) {
    border-color: var(--cinnabar);
    color: var(--cinnabar);
    transform: translateY(-1px);
    box-shadow: var(--shadow-card);
  }

  &:active:not(:disabled) {
    transform: scale(0.96);
  }

  &--seal {
    background: var(--cinnabar);
    border-color: var(--cinnabar);
    color: #ffffff;

    &:hover:not(:disabled) {
      background: var(--accent-red-hover);
      border-color: var(--accent-red-hover);
      color: #ffffff;
    }
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.preview-card__diff {
  list-style: none;
  margin: 10px 0 0;
  padding: 10px 12px;
  background: var(--code-bg);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-primary);
  display: grid;
  gap: 4px;
  max-height: 220px;
  overflow: auto;

  code {
    color: var(--bamboo);
    margin-right: 6px;
  }
}
</style>

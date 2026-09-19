<script setup lang="ts">
const props = defineProps<{
  name: string
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
}>()

const isOpen = ref(false)

const LABELS: Record<string, { label: string; icon: string }> = {
  get_plan: { label: '翻阅行程', icon: 'book' },
  apply_plan_edits: { label: '落笔编排', icon: 'doc' },
  patch_plan_json: { label: '斟酌细修', icon: 'doc' },
  get_panorama: { label: '采风街景', icon: 'mountain' },
  search_poi: { label: '循迹寻胜', icon: 'compass' },
  search_web: { label: '联网搜索 · Tavily', icon: 'compass' },
}

const info = computed(() => LABELS[props.name] ?? { label: props.name, icon: 'spark' })
const isExecuting = computed(() => props.state === 'input-streaming' || props.state === 'input-available')
const isDone = computed(() => props.state === 'output-available')
const isError = computed(() => props.state === 'output-error')

const stateText = computed(() => {
  if (isExecuting.value) return '执行中'
  if (isDone.value) return '已完成'
  if (isError.value) return '出错'
  return props.state ?? ''
})

function pretty(value: unknown): string {
  if (value === undefined || value === null) return ''
  const text = JSON.stringify(value, null, 2)
  return text.length > 2400 ? `${text.slice(0, 2400)}\n…（截断）` : text
}
</script>

<template>
  <div class="tool-card" :class="{ 'is-executing': isExecuting, 'is-error': isError }">
    <div
      class="tool-card__header"
      role="button"
      tabindex="0"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
      @keydown.enter.space.prevent="isOpen = !isOpen"
    >
      <div class="tool-card__left">
        <AppIcon
          :name="info.icon as any"
          :size="14"
          class="tool-card__icon"
          :class="{ spinning: isExecuting }"
        />
        <span class="tool-card__name">{{ info.label }}</span>
      </div>

      <div class="tool-card__right">
        <span v-if="stateText" class="tag" :class="{ 'tag--executing': isExecuting, 'tag--done': isDone, 'tag--error': isError }">
          {{ stateText }}
        </span>
        <AppIcon
          name="chevron"
          :size="11"
          class="chevron-rotator"
          :class="{ rotated: isOpen }"
        />
      </div>
    </div>

    <!-- 0-JS 平滑高度折叠壳 -->
    <div class="collapse-shell" :class="{ collapsed: !isOpen }">
      <div class="collapse-inner">
        <div class="tool-card__body">
          <div v-if="input" class="tool-card__section">
            <div class="tool-card__label">入参</div>
            <pre><code>{{ pretty(input) }}</code></pre>
          </div>
          <div v-if="output" class="tool-card__section">
            <div class="tool-card__label">出参</div>
            <pre><code>{{ pretty(output) }}</code></pre>
          </div>
          <div v-if="errorText" class="tool-card__error">{{ errorText }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use "~/assets/styles/variables" as *;

.tool-card {
  margin: 8px 0;
  border: 1px solid var(--border-secondary);
  border-radius: 8px;
  background-color: var(--bg-card-muted);
  max-width: 580px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  transition: border-color $dur-base $ease-soft, background-color $dur-base $ease-soft;

  &.is-executing {
    border-color: var(--bamboo);
    background-image: linear-gradient(
      100deg,
      transparent 20%,
      var(--accent-cyan-subtle) 45%,
      transparent 70%
    );
    background-size: 220% 100%;
    animation: shimmer 1.8s linear infinite;
  }

  &.is-error {
    border-color: var(--accent-red);
    background-color: var(--cinnabar-soft);
  }
}

.tool-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  transition: background-color $dur-fast $ease-soft;

  &:hover {
    background-color: rgba(0, 0, 0, 0.02);
  }
}

.tool-card__left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-card__icon {
  color: var(--bamboo);
  transition: transform $dur-base $ease-soft;

  &.spinning {
    animation: spin 1.2s linear infinite;
  }
}

.tool-card__name {
  font-weight: 500;
  color: var(--text-primary);
  font-size: 12px;
}

.tool-card__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tag {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;

  &--executing {
    background-color: var(--accent-cyan-subtle);
    color: var(--bamboo);
    animation: breathe 1.2s ease-in-out infinite;
  }

  &--done {
    background-color: rgba(82, 115, 98, 0.12);
    color: var(--bamboo);
    animation: pop 0.4s $ease-spring both;
  }

  &--error {
    background-color: var(--cinnabar-soft);
    color: var(--cinnabar);
  }
}

.tool-card__body {
  border-top: 1px dashed var(--border-primary);
  padding: 10px 12px;
  background-color: var(--bg-card);
}

.tool-card__section {
  margin-bottom: 8px;
  &:last-child { margin-bottom: 0; }
}

.tool-card__label {
  font-size: 11px;
  color: var(--gold-deep);
  letter-spacing: 0.1em;
  margin-bottom: 4px;
  font-weight: 600;
}

.tool-card pre {
  margin: 0;
  background: var(--code-bg);
  border: 1px solid var(--border-secondary);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 11.5px;
  font-family: $font-mono;
  overflow: auto;
  max-height: 220px;
  line-height: 1.5;
  color: var(--text-primary);
}

.tool-card__error {
  color: var(--cinnabar);
  font-size: 12px;
  margin-top: 4px;
}
</style>

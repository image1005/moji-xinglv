<script setup lang="ts">
import { api } from '~/utils/api'

const props = defineProps<{ fixedScope?: 'plan' | 'global' }>()

const { currentPlan } = useWorkspace()

const scope = ref<'plan' | 'global'>(props.fixedScope ?? 'plan')
const content = ref('')
const version = ref(0)
const status = ref('')
const saving = ref(false)

watch(
  () => props.fixedScope,
  (value) => {
    if (value) scope.value = value
  },
)

async function load() {
  const planId = scope.value === 'plan' ? (currentPlan.value?.id ?? null) : null
  const res = await api.agentsMd.get(planId)
  content.value = res.content
  version.value = res.version
  status.value = ''
}

watch([scope, () => currentPlan.value?.id], () => void load(), { immediate: true })

async function save() {
  saving.value = true
  try {
    const planId = scope.value === 'plan' ? (currentPlan.value?.id ?? null) : null
    const res = await api.agentsMd.save({ planId, content: content.value })
    version.value = res.version
    status.value = `已保存（v${res.version}）`
  } catch (error) {
    status.value = error instanceof Error ? error.message : '保存失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="agents-panel">
    <div class="agents-panel__scope">
      <button
        v-if="!fixedScope"
        class="agents-panel__scope-btn"
        :class="{ 'agents-panel__scope-btn--active': scope === 'plan' }"
        :disabled="!currentPlan"
        @click="scope = 'plan'"
      >
        本规划
      </button>
      <button
        v-if="!fixedScope"
        class="agents-panel__scope-btn"
        :class="{ 'agents-panel__scope-btn--active': scope === 'global' }"
        @click="scope = 'global'"
      >
        全局偏好
      </button>
      <span v-if="fixedScope" class="agents-panel__scope-label">
        {{ fixedScope === 'global' ? '全局偏好' : '本规划偏好' }}
      </span>
      <span class="agents-panel__version">v{{ version }}</span>
    </div>
    <p class="agents-panel__hint">
      优先级：本规划 &gt; 全局 &gt; 系统默认。支持
      <code v-pre>{{nickname}}</code>、<code v-pre>{{currency}}</code>
      占位符；上限 4000 字，服务端会过滤注入指令。
    </p>
    <ClientOnly>
      <MdEditor v-model="content" />
      <template #fallback>
        <textarea v-model="content" class="agents-panel__fallback" rows="12" />
      </template>
    </ClientOnly>
    <div class="agents-panel__actions">
      <button class="btn btn--ghost btn--small" @click="load">重置</button>
      <button class="btn btn--seal btn--small" :disabled="saving" @click="save">保存</button>
    </div>
    <p v-if="status" class="agents-panel__status">{{ status }}</p>
  </div>
</template>

<style scoped>
.agents-panel {
  display: grid;
  gap: 10px;
}
.agents-panel__scope {
  display: flex;
  gap: 6px;
  align-items: center;
}
.agents-panel__scope-btn {
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink-soft);
  font-size: 12px;
  padding: 3px 12px;
  border-radius: 3px;
  cursor: pointer;
}
.agents-panel__scope-btn--active {
  background: var(--bamboo);
  border-color: var(--bamboo);
  color: var(--paper);
}
.agents-panel__version {
  margin-left: auto;
  font-family: var(--font-serif);
  color: var(--gold-deep);
  font-size: 12px;
}
.agents-panel__scope-label {
  font-size: 12px;
  color: var(--bamboo);
}
.agents-panel__hint {
  margin: 0;
  font-size: 12px;
  color: var(--ink-faint);
  line-height: 1.7;
}
.agents-panel__hint code {
  background: var(--paper);
  border: 1px solid var(--line-soft);
  padding: 0 3px;
  border-radius: 2px;
}
.agents-panel__fallback {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 8px;
  font-size: 13px;
  font-family: inherit;
  background: var(--paper);
}
.agents-panel__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.agents-panel__status {
  margin: 0;
  font-size: 12px;
  color: var(--bamboo);
}
</style>

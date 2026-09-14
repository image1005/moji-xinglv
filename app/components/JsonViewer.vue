<script setup lang="ts">
import { PlanSchema } from '#shared/schemas/plan'

const { currentPlan, savePlan } = useWorkspace()

const text = ref('')
const message = ref('')
const isError = ref(false)
const copied = ref(false)

watch(
  () => currentPlan.value?.plan,
  (plan) => {
    if (plan) {
      text.value = JSON.stringify(plan, null, 2)
      message.value = ''
      isError.value = false
    }
  },
  { immediate: true, deep: true },
)

async function save() {
  message.value = ''
  isError.value = false
  let parsed: unknown
  try {
    parsed = JSON.parse(text.value)
  } catch {
    isError.value = true
    message.value = 'JSON 语法错误，请检查后再保存'
    return
  }
  const result = PlanSchema.safeParse(parsed)
  if (!result.success) {
    isError.value = true
    message.value = `校验失败：${result.error.issues[0]?.path.join('.') || '$'} ${result.error.issues[0]?.message}`
    return
  }
  const saved = await savePlan(result.data)
  isError.value = false
  message.value = saved?.skipped ? '内容无变化，未生成新版本' : `已保存为 v${saved?.version}`
}

async function copy() {
  await navigator.clipboard.writeText(text.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="json-viewer">
    <textarea v-model="text" spellcheck="false" />
    <div class="json-viewer__actions">
      <button class="btn btn--ghost btn--small" @click="copy">{{ copied ? '已复制' : '复制' }}</button>
      <button class="btn btn--seal btn--small" @click="save">保存 JSON</button>
    </div>
    <p v-if="message" class="json-viewer__message" :class="{ 'json-viewer__message--error': isError }">
      {{ message }}
    </p>
  </div>
</template>

<style scoped>
.json-viewer {
  display: grid;
  gap: 8px;
  height: 100%;
}
.json-viewer textarea {
  width: 100%;
  min-height: 62vh;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--paper);
  padding: 10px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
  color: var(--ink);
}
.json-viewer textarea:focus {
  outline: none;
  border-color: var(--bamboo);
}
.json-viewer__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.json-viewer__message {
  margin: 0;
  font-size: 12px;
  color: var(--bamboo);
}
.json-viewer__message--error {
  color: var(--cinnabar);
}
</style>

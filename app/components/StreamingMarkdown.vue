<script setup lang="ts">
import { useTypewriterStream } from '~/composables/useTypewriterStream'

const props = defineProps<{ value: string; streaming?: boolean }>()
const state = reactive({ content: props.value })
const displayed = computed(() => state.content)
let lastSource = props.value

const typewriter = useTypewriterStream({ tickMs: 16 })
typewriter.bind(state as unknown as Record<string, unknown>, 'content')

watch(() => props.value, (newVal) => {
  if (!props.streaming) {
    typewriter.flushInstant()
    state.content = newVal
    lastSource = newVal
    return
  }

  if (newVal.startsWith(lastSource)) {
    const delta = newVal.slice(lastSource.length)
    if (delta) {
      typewriter.push(delta)
    }
  } else {
    typewriter.reset()
    state.content = newVal
  }
  lastSource = newVal
})

watch(() => props.streaming, (isStreaming) => {
  if (!isStreaming) {
    typewriter.flushInstant()
    state.content = props.value
    lastSource = props.value
  }
})

onBeforeUnmount(() => typewriter.flushInstant())
onDeactivated(() => typewriter.flushInstant())
onActivated(() => {
  typewriter.flushInstant()
  state.content = props.value
  lastSource = props.value
})
</script>

<template>
  <div class="streaming-md markdown-body">
    <MDC :value="displayed" />
    <span v-if="streaming" class="ink-typing-cursor" aria-hidden="true" />
  </div>
</template>

<style scoped>
.streaming-md {
  position: relative;
}
.ink-typing-cursor {
  display: inline-block;
  width: 2px;
  height: 1.1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background-color: var(--cinnabar);
  animation: ink-cursor-blink 0.9s steps(2, start) infinite;
}
</style>

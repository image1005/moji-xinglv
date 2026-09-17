<script setup lang="ts">
const props = defineProps<{ value: string; streaming?: boolean }>()
const displayed = ref(props.value)
let timer: ReturnType<typeof setTimeout> | undefined
function flush() { clearTimeout(timer); timer = undefined; displayed.value = props.value }
watch(() => [props.value, props.streaming], () => {
  if (!props.streaming) { flush(); return }
  timer ??= setTimeout(flush, 160)
})
onBeforeUnmount(() => clearTimeout(timer))
onDeactivated(() => clearTimeout(timer))
onActivated(flush)
</script>

<template><MDC :value="displayed" /></template>

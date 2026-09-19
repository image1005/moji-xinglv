<script setup lang="ts">
withDefaults(defineProps<{ size?: number; decorative?: boolean }>(), { size: 40, decorative: false })
</script>

<template>
  <img src="/brand/shanhai-xingjian.svg" :width="size" :height="size" :alt="decorative ? '' : '山海行笺'" :aria-hidden="decorative || undefined" class="brand-mark">
</template>

<style scoped>
.brand-mark { display: block; flex-shrink: 0; object-fit: contain; }
</style>

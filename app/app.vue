<script setup lang="ts">
const { user } = useCurrentUser()
const { initTheme } = useAppTheme()

if (import.meta.client) {
  initTheme()
}

onMounted(() => {
  initTheme()
})
</script>

<template>
  <NuxtLoadingIndicator color="var(--cinnabar)" :height="2" />
  <NuxtPage :key="user?.id ?? 'guest'" />
</template>

<script setup lang="ts">
const { user } = useCurrentUser()
</script>

<template>
  <NuxtLoadingIndicator color="var(--cinnabar)" :height="2" />
  <NuxtPage :key="user?.id ?? 'guest'" />
</template>

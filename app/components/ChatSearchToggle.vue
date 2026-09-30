<script setup lang="ts">
defineProps<{ enabled: boolean; disabled: boolean; available: boolean; descriptionId: string }>()
const emit = defineEmits<{ change: [value: boolean] }>()
</script>

<template>
  <button
    type="button"
    class="configuration-control"
    :class="{ 'configuration-control--active': enabled && available }"
    aria-label="智能搜索"
    :aria-pressed="enabled"
    :aria-disabled="!available"
    :aria-describedby="descriptionId"
    :disabled="disabled"
    @click="available && emit('change', !enabled)"
  >
    <AppIcon name="search" :size="15" />
    <span>智能搜索</span>
    <span class="configuration-control__value">{{ !available ? '不可用' : enabled ? '已开启' : '已关闭' }}</span>
    <AppIcon v-if="enabled && available" name="check" :size="12" />
  </button>
</template>

<style scoped lang="scss">
@use '../assets/styles/configuration-control';
</style>

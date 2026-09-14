<script setup lang="ts">
type IconName =
  | 'search'
  | 'sort'
  | 'plus'
  | 'folder'
  | 'chat'
  | 'doc'
  | 'gear'
  | 'chevron'
  | 'menu'
  | 'back'
  | 'send'
  | 'stop'

const props = defineProps<{ name: IconName; size?: number }>()

const PATHS: Record<IconName, string> = {
  search: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm4.2.2L15 16',
  sort: 'M2 4h9M2 8h6M2 12h4M13 3v10M10.5 10.5 13 13l2.5-2.5',
  plus: 'M8 3.5v9M3.5 8h9',
  folder: 'M2 4h4.5l1.5 2H14v7.5H2z',
  chat: 'M2.5 3.5h11v7.5H8l-3.5 2.5V11h-2z',
  doc: 'M4 2h5l3 3v9H4zM8.5 2v3.5H12',
  gear: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0-8v1.6M8 12.4V14M2 8h1.6M12.4 8H14M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M12.2 3.8l-1.1 1.1M4.9 11.1l-1.1 1.1',
  chevron: 'M6 4l4 4-4 4',
  menu: 'M2 4h12M2 8h12M2 12h12',
  back: 'M10 3 5 8l5 5',
  send: 'M8 13.5V3M4 7l4-4 4 4',
  stop: 'M5 5h6v6H5z',
}
</script>

<template>
  <svg
    class="app-icon"
    viewBox="0 0 16 16"
    :width="props.size ?? 16"
    :height="props.size ?? 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="PATHS[props.name]" />
  </svg>
</template>

<style scoped>
.app-icon {
  display: block;
  flex-shrink: 0;
}
</style>

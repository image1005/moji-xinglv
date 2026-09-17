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
  | 'close'
  | 'book'
  | 'mountain'
  | 'compass'
  | 'leaf'
  | 'bowl'
  | 'calendar'
  | 'pin'
  | 'check'
  | 'arrow'
  | 'spark'
  | 'wallet'
  | 'sun'
  | 'moon'
  | 'sidebar'

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
  close: 'M4 4l8 8M12 4l-8 8',
  book: 'M8 4c-2-1.5-4-1.5-6-1v10c2-.5 4-.5 6 1 2-1.5 4-1.5 6-1V3c-2-.5-4-.5-6 1Zm0 0v10M4 6h1M11 6h1',
  mountain: 'M1 13 6 4l3 5 2-3 4 7H1ZM4.5 7l1.5 1 1.5-1M10 2h.01',
  compass: 'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm2.5-8.5L9 9l-3.5 1.5L7 7l3.5-1.5Z',
  leaf: 'M3 12C-1 5 6 2 14 2c0 8-3 13-9 10M2 14l8-8',
  bowl: 'M2 7h12c-.3 4-2.5 6-6 6s-5.7-2-6-6ZM5 14h6M6 2c-1 1 1 2 0 3M10 1c-1 1 1 2 0 3',
  calendar: 'M2.5 4h11v10h-11ZM5 2v4M11 2v4M2.5 7h11M5 10h1M9 10h1',
  pin: 'M12.5 6.5C12.5 10 8 14 8 14S3.5 10 3.5 6.5a4.5 4.5 0 0 1 9 0Zm-3 0a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0Z',
  check: 'M3 8l3 3 7-7',
  arrow: 'M2 8h11M9 4l4 4-4 4',
  spark: 'm8 2 1.5 4.5L14 8l-4.5 1.5L8 14 6.5 9.5 2 8l4.5-1.5L8 2Z',
  wallet: 'M3 3h10v3M13 4H2v10h12V6H2M10 8h4v3h-4V8Z',
  sun: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 1v2M8 13v2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M1 8h2M13 8h2M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41',
  moon: 'M13.5 9.8A5.5 5.5 0 0 1 6.2 2.5 5.5 5.5 0 1 0 13.5 9.8Z',
  sidebar: 'M2 2.5h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Zm4 0v11',
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

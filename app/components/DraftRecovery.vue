<script setup lang="ts">
import type { DraftDifference } from '~/utils/draft-merge'
defineProps<{ persisted: boolean; storageError?: string; busy?: boolean; differences?: DraftDifference[] | null }>()
defineEmits<{ compare: []; reapply: [] }>()
</script>

<template>
  <div class="draft-recovery" role="status">
    <p>{{ persisted ? '未保存的草稿 · 已保存在本机，切换行笺或刷新后可继续' : '未保存的草稿' }}</p>
    <p v-if="storageError" class="draft-recovery__error">{{ storageError }}</p>
    <button class="btn btn--ghost btn--small" type="button" :disabled="busy" @click="$emit('compare')">比较最新内容</button>
    <template v-if="differences">
      <p>以下是你修改的字段。重新应用会保留其他人的无关修改；确认后仍需点击保存。</p>
      <dl v-for="(row, index) in differences" :key="index"><dt>{{ row.label }}</dt><dd><strong>最新：</strong>{{ row.current }}</dd><dd><strong>草稿：</strong>{{ row.draft }}</dd></dl>
      <p v-if="!differences.length">草稿与最新内容没有字段差异。</p>
      <button class="btn btn--seal btn--small" type="button" :disabled="busy" @click="$emit('reapply')">在最新内容上重新应用草稿</button>
    </template>
  </div>
</template>

<style scoped>
.draft-recovery { padding: 12px 15px; border: 1px dashed var(--gold); background: var(--paper); color: var(--ink-soft); font-size: 12px; line-height: 1.7; }
.draft-recovery p { margin: 0 0 8px; }.draft-recovery dl { margin: 10px 0; padding: 8px; background: var(--paper-deep); }.draft-recovery dt { font-weight: 600; }.draft-recovery dd { margin: 3px 0; white-space: pre-wrap; overflow-wrap: anywhere; }.draft-recovery__error { color: var(--cinnabar); }
</style>

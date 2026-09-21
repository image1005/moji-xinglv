<script setup lang="ts">
import type { PlanResource } from '#shared/schemas/media'
defineProps<{ resource?: PlanResource; label: string; busy?: boolean; disabled?: boolean }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <figure class="resource-image">
    <div class="resource-image__frame">
      <CachedImage v-if="resource?.image" :src="resource.image.url" :alt="`${label} · ${resource.image.kind === 'food_illustration' ? '菜品示意' : '地点实拍'}`" />
      <div v-else class="resource-image__empty"><AppIcon :name="resource?.entityType === 'food' ? 'bowl' : 'mountain'" :size="24" /><span>{{ busy ? '正在查找匹配图片…' : resource?.imageIssue?.code === 'no_match' || resource?.status === 'not_found' ? '图库暂无匹配图片' : resource?.imageIssue || resource?.status === 'failed' ? '图片来源请求失败' : '图片待补充' }}</span></div>
    </div>
    <figcaption>
      <strong>{{ label }}</strong>
      <span v-if="resource?.image">{{ resource.image.kind === 'food_illustration' ? '菜品示意，非指定餐厅实拍' : '地点实拍' }}</span>
      <span v-if="resource?.image?.matchedName && resource.image.matchedName !== label">图片对应：{{ resource.image.matchedName }}</span>
      <a v-if="resource?.image" :href="resource.image.sourceUrl" target="_blank" rel="noopener noreferrer">{{ resource.image.provider }} · {{ resource.image.attribution || '查看来源' }}</a>
      <span v-if="resource?.error" class="resource-image__error">{{ resource.error }}</span>
      <button v-if="resource && (!resource.image || resource.error)" type="button" :disabled="busy || disabled" @click="$emit('retry')">{{ busy ? '查找中…' : resource.imageIssue?.code === 'no_match' ? '重新查找图片与定位' : '重试图片与定位' }}</button>
    </figcaption>
  </figure>
</template>

<style scoped>
.resource-image { margin: 0; border: 1px solid var(--border-primary); background: var(--bg-card); border-radius: 6px; overflow: hidden; min-width: 0; }
.resource-image__frame { height: 138px; }
.resource-image__empty { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 9px; height: 100%; background: var(--bg-card-muted); color: var(--text-muted); font-size: 11px; }
.resource-image figcaption { display: flex; flex-direction: column; gap: 5px; padding: 10px; font-size: 10px; line-height: 1.5; color: var(--text-muted); overflow-wrap: anywhere; }
.resource-image strong { font-size: 13px; font-weight: 500; color: var(--text-primary); }
.resource-image a { color: var(--bamboo); }
.resource-image button { align-self: flex-start; padding: 3px 0; border: 0; background: transparent; color: var(--cinnabar); font-size: 11px; cursor: pointer; }
</style>

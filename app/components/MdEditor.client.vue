<script setup lang="ts">
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'

const model = defineModel<string>({ default: '' })
</script>

<template>
  <MdEditor
    v-model="model"
    language="zh-CN"
    :toolbars="['bold', 'italic', 'title', 'quote', 'unorderedList', 'orderedList', 'link', 'code', 'preview', 'revoke', 'next']"
    style="height: 340px"
  />
</template>

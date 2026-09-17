<script setup lang="ts">
const props = withDefaults(defineProps<{
  open: boolean
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  loading?: boolean
}>(), {
  title: '确认操作',
  description: '',
  confirmText: '确认',
  cancelText: '取消',
  danger: true,
  loading: false,
})

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
  }
}

onMounted(() => {
  if (import.meta.client) window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  if (import.meta.client) window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      @click="emit('cancel')"
    >
      <div class="modal-card" @click.stop>
        <div class="modal-header">
          <span class="modal-seal" aria-hidden="true">{{ danger ? '删' : '注' }}</span>
          <h3 class="modal-title">{{ title }}</h3>
          <button
            type="button"
            class="modal-close"
            aria-label="关闭"
            :disabled="loading"
            @click="emit('cancel')"
          >
            <AppIcon name="close" :size="14" />
          </button>
        </div>

        <div class="modal-body">
          <p class="modal-desc">{{ description }}</p>
        </div>

        <div class="modal-footer">
          <button
            type="button"
            class="btn btn--ghost btn--small"
            :disabled="loading"
            @click="emit('cancel')"
          >
            {{ cancelText }}
          </button>
          <button
            type="button"
            class="btn btn--small"
            :class="danger ? 'btn--seal' : ''"
            :disabled="loading"
            @click="emit('confirm')"
          >
            {{ loading ? '正在处理…' : confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
@use "~/assets/styles/variables" as *;

.modal-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: $z-modal;
  padding: 16px;
  animation: fade-in $dur-base $ease-soft both;
}

.modal-card {
  width: 100%;
  max-width: 430px;
  background-color: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 14px;
  box-shadow: var(--shadow-float);
  padding: 22px 24px;
  animation: modal-card-in $dur-slow $ease-ink both;
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-secondary);

  .modal-seal {
    width: 24px;
    height: 24px;
    border-radius: 5px;
    background-color: var(--cinnabar);
    color: #ffffff;
    font-family: var(--font-serif);
    font-weight: 700;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 6px var(--accent-red-subtle);
  }

  .modal-title {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
  }

  .modal-close {
    border: none;
    background: transparent;
    color: var(--text-muted);
    padding: 6px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all $dur-fast $ease-soft;

    &:hover {
      color: var(--text-primary);
      background-color: var(--bg-sidebar-hover);
    }
  }
}

.modal-body {
  margin-bottom: 20px;

  .modal-desc {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.75;
    color: var(--text-secondary);
  }
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>

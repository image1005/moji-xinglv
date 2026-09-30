<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { ModelConfiguration } from '#shared/schemas/model-config'

type ThinkingLevel = ModelConfiguration['thinking']
const props = defineProps<{
  value: ThinkingLevel
  levels: ThinkingLevel[]
  disabled: boolean
  unavailableReason?: string
}>()
const emit = defineEmits<{ change: [value: ThinkingLevel] }>()
const choices = [
  { value: 'off', label: '关闭', icon: 'moon', description: '不额外启用思考' },
  { value: 'light', label: '轻量', icon: 'leaf', description: '较少思考，适合简单问题' },
  { value: 'standard', label: '标准', icon: 'spark', description: '均衡思考与响应速度' },
  { value: 'deep', label: '深度', icon: 'compass', description: '更多推敲，复杂任务可能需要更久' },
] as const
const selected = computed(() => choices.find(choice => choice.value === props.value)!)
const trigger = ref<HTMLButtonElement>()
const menu = ref<HTMLDivElement>()
const open = ref(false)
const position = ref<CSSProperties>({ visibility: 'hidden', left: 0, top: 0 })
const menuId = `thinking-${useId()}`
const unavailableReason = computed(() => props.unavailableReason || '当前模型接口未提供此思考档位')

function placeMenu() {
  if (!open.value || !trigger.value || !menu.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const viewport = window.visualViewport
  const left = viewport?.offsetLeft ?? 0
  const top = viewport?.offsetTop ?? 0
  const width = viewport?.width ?? window.innerWidth
  const height = viewport?.height ?? window.innerHeight
  const margin = 12
  const gap = 8
  const above = Math.max(0, anchor.top - top - margin - gap)
  const below = Math.max(0, top + height - anchor.bottom - margin - gap)
  const upwards = above >= menu.value.scrollHeight || above >= below
  const maxHeight = Math.max(0, Math.min(upwards ? above : below, height - 2 * margin))
  const menuHeight = Math.min(menu.value.scrollHeight, maxHeight)
  const menuWidth = Math.min(menu.value.offsetWidth, width - 2 * margin)
  position.value = {
    left: `${Math.max(left + margin, Math.min(anchor.left, left + width - menuWidth - margin))}px`,
    top: `${Math.max(top + margin, Math.min(upwards ? anchor.top - gap - menuHeight : anchor.bottom + gap, top + height - menuHeight - margin))}px`,
    maxHeight: `${maxHeight}px`,
    maxWidth: `${width - 2 * margin}px`,
  }
}

function closeMenu(restoreFocus = false) {
  open.value = false
  if (restoreFocus) trigger.value?.focus({ preventScroll: true })
}

function focusItem(target?: HTMLButtonElement) {
  if (!target || !menu.value) return
  target.focus({ preventScroll: true })
  const item = target.getBoundingClientRect()
  const panel = menu.value.getBoundingClientRect()
  const top = panel.top + menu.value.clientTop
  const bottom = top + menu.value.clientHeight
  // Only scroll the portaled menu; native focus/scrollIntoView can also move the page.
  if (item.top < top) menu.value.scrollTop -= top - item.top
  else if (item.bottom > bottom) menu.value.scrollTop += item.bottom - bottom
}

async function showMenu(edge?: 'first' | 'last') {
  if (props.disabled) return
  position.value = { visibility: 'hidden', left: 0, top: 0 }
  open.value = true
  await nextTick()
  if (!open.value) return
  placeMenu()
  await nextTick()
  if (!open.value) return
  const items = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
  const current = items.find(item => item.getAttribute('aria-checked') === 'true')
  const target = edge === 'first' ? items[0] : edge === 'last' ? items.at(-1) : current ?? items[0]
  focusItem(target)
}

function choose(value: ThinkingLevel) {
  if (props.disabled || !props.levels.includes(value)) return
  emit('change', value)
  closeMenu(true)
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    void showMenu(event.key === 'ArrowDown' ? 'first' : 'last')
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    closeMenu(true)
  }
}

function onMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu(true)
  } else if (event.key === 'Tab') {
    // Restore the anchor before native Tab traversal; the portal is last in body.
    closeMenu(true)
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const items = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
    const current = items.findIndex(item => item === document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    focusItem(items[next])
  }
}

function outside(event: Event) {
  if (!open.value || !(event.target instanceof Node)) return
  if (trigger.value?.contains(event.target) || menu.value?.contains(event.target)) return
  closeMenu(event.type === 'pointerdown')
}

watch(() => props.disabled, disabled => { if (disabled) closeMenu() })
onMounted(() => {
  document.addEventListener('pointerdown', outside)
  document.addEventListener('focusin', outside)
  window.addEventListener('resize', placeMenu)
  window.addEventListener('scroll', placeMenu, true)
  window.visualViewport?.addEventListener('resize', placeMenu)
  window.visualViewport?.addEventListener('scroll', placeMenu)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('focusin', outside)
  window.removeEventListener('resize', placeMenu)
  window.removeEventListener('scroll', placeMenu, true)
  window.visualViewport?.removeEventListener('resize', placeMenu)
  window.visualViewport?.removeEventListener('scroll', placeMenu)
})
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="configuration-control"
    :class="{ 'configuration-control--active': value !== 'off' }"
    :aria-label="`思考深度：${selected.label}`"
    aria-haspopup="menu"
    :aria-expanded="open"
    :aria-controls="open ? menuId : undefined"
    :disabled="disabled"
    @click="open ? closeMenu() : showMenu()"
    @keydown="onTriggerKeydown"
  >
    <AppIcon :name="selected.icon" :size="15" />
    <span>思考</span>
    <span class="configuration-control__value">{{ selected.label }}</span>
    <AppIcon name="chevron" :size="12" class="thinking-chevron" :class="{ 'thinking-chevron--open': open }" />
  </button>
  <Teleport to="body">
    <div v-if="open" :id="menuId" ref="menu" class="thinking-menu" :style="position" role="menu" aria-label="思考深度" @keydown="onMenuKeydown">
      <div class="thinking-menu__heading" aria-hidden="true">思考深度</div>
      <button
        v-for="choice in choices"
        :key="choice.value"
        type="button"
        role="menuitemradio"
        class="thinking-menu__option"
        :class="{ 'thinking-menu__option--selected': value === choice.value }"
        :aria-label="choice.label"
        :aria-checked="value === choice.value"
        :aria-disabled="!levels.includes(choice.value)"
        :aria-describedby="`${menuId}-${choice.value}`"
        tabindex="-1"
        @click="choose(choice.value)"
      >
        <AppIcon :name="choice.icon" :size="17" />
        <span class="thinking-menu__copy">
          <span class="thinking-menu__label">{{ choice.label }}<span v-if="!levels.includes(choice.value)" class="thinking-menu__unavailable">暂不支持</span></span>
          <span :id="`${menuId}-${choice.value}`" class="thinking-menu__description">{{ levels.includes(choice.value) ? choice.description : unavailableReason }}</span>
        </span>
        <AppIcon v-if="value === choice.value" name="check" :size="16" class="thinking-menu__check" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
@use '../assets/styles/configuration-control';
.thinking-chevron { transform: rotate(90deg); transition: transform 120ms; }
.thinking-chevron--open { transform: rotate(-90deg); }
.thinking-menu {
  position: fixed;
  z-index: 80;
  box-sizing: border-box;
  width: min(288px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 5px;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-card);
  box-shadow: var(--shadow-float);
  color: var(--text-primary);
}
.thinking-menu__heading { margin: 0 6px 4px; padding: 7px 3px; border-bottom: 1px solid var(--border-secondary); color: var(--gold-deep); font-size: 11px; letter-spacing: .08em; }
.thinking-menu__option { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px; border: 0; border-radius: 5px; background: transparent; color: var(--text-secondary); text-align: left; font: inherit; cursor: pointer; }
.thinking-menu__option:hover, .thinking-menu__option:focus-visible { background: var(--bg-card-muted); }
.thinking-menu__option:focus-visible { outline: 2px solid var(--bamboo); outline-offset: -2px; }
.thinking-menu__option--selected { color: var(--bamboo); }
.thinking-menu__option[aria-disabled="true"] { color: var(--text-muted); cursor: not-allowed; }
.thinking-menu__copy { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
.thinking-menu__label { font-size: 13px; line-height: 20px; }
.thinking-menu__description { color: var(--text-muted); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.thinking-menu__unavailable { margin-left: 8px; font-size: 10px; }
.thinking-menu__check { color: var(--bamboo); }
@media (prefers-reduced-motion: reduce) { .thinking-chevron { transition: none; } }
</style>

<script setup lang="ts">
import type { Plan, FoodEntry, Spot } from '#shared/schemas/plan'

const props = defineProps<{ plan: Plan }>()
const spotCount = computed(() => props.plan.days.reduce((total, day) => total + day.spots.length, 0))
const categories: Record<Spot['category'], string> = { sight: '游览', food: '餐饮', stay: '住宿', transport: '交通' }
const meals: Record<FoodEntry['meal'], string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '小食' }
function money(value: number) { return `${value.toLocaleString('zh-CN')} ${props.plan.budget.currency}` }
function hideBrokenImage(event: Event) { if (event.target instanceof HTMLImageElement) event.target.style.display = 'none' }
</script>

<template>
  <article class="snapshot" aria-label="历史行程快照">
    <header class="snapshot__overview">
      <p class="snapshot__eyebrow">行程总览 · 只读快照</p>
      <h3>{{ plan.title }}</h3>
      <img v-if="plan.cover" class="snapshot__cover" :src="plan.cover" :alt="`${plan.title}的历史封面`" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="hideBrokenImage">
      <p class="snapshot__prose">{{ plan.summary || '此版本尚未填写行程简介。' }}</p>
      <div class="snapshot__stats"><span>{{ plan.days.length }} 天行程</span><span>{{ spotCount }} 处地点</span><span>预算 {{ money(plan.budget.total) }}</span></div>
      <ul v-if="plan.tags.length" class="snapshot__tags" aria-label="行程标签"><li v-for="(tag, index) in plan.tags" :key="index">{{ tag }}</li></ul>
    </header>

    <section class="snapshot__section" aria-label="每日安排">
      <h3>每日安排</h3>
      <p v-if="!plan.days.length" class="snapshot__empty">此版本尚未安排每日行程。</p>
      <article v-for="(day, dayIndex) in plan.days" :key="dayIndex" class="snapshot__day">
        <header class="snapshot__day-head"><strong>第 {{ dayIndex + 1 }} 天</strong><span>{{ day.city || '城市待定' }}</span><time v-if="day.date">{{ day.date }}</time></header>
        <ol v-if="day.spots.length" class="snapshot__spots">
          <li v-for="(spot, spotIndex) in day.spots" :key="spot.id || spotIndex">
            <div class="snapshot__spot-head"><h4>{{ spot.name }}</h4><span>{{ categories[spot.category] }}</span><time v-if="spot.time">{{ spot.time }}</time></div>
            <p v-if="spot.address" class="snapshot__prose">{{ spot.address }}</p>
            <p class="snapshot__detail">停留 {{ spot.durationMinutes }} 分钟 · 花费 {{ money(spot.cost) }}<span v-if="spot.lng === null"> · 地点待定位</span><span v-else> · {{ spot.lng }}, {{ spot.lat }}</span></p>
            <p v-if="spot.notes" class="snapshot__prose">{{ spot.notes }}</p>
            <img v-if="spot.imageUrl || spot.panorama" class="snapshot__spot-image" :src="spot.imageUrl || spot.panorama" :alt="`${spot.name}的历史图片`" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="hideBrokenImage">
          </li>
        </ol>
        <p v-else class="snapshot__empty">这一天尚未添加地点。</p>
        <dl class="snapshot__logistics">
          <div><dt>交通</dt><dd>{{ day.transport || '尚未安排' }}</dd></div>
          <div><dt>住宿</dt><dd>{{ day.lodging || '尚未安排' }}</dd></div>
          <div v-if="day.meals.length"><dt>餐饮</dt><dd><ul><li v-for="(meal, index) in day.meals" :key="index">{{ meal }}</li></ul></dd></div>
        </dl>
      </article>
    </section>

    <section class="snapshot__section" aria-label="预算">
      <h3>行程预算</h3>
      <dl class="snapshot__budget"><div><dt>预算总额</dt><dd>{{ money(plan.budget.total) }}</dd></div><div v-for="(amount, category) in plan.budget.breakdown" :key="category"><dt>{{ category }}</dt><dd>{{ money(amount) }}</dd></div></dl>
    </section>

    <section class="snapshot__section" aria-label="风物食记">
      <h3>风物食记</h3>
      <p v-if="!plan.foodJournal.length" class="snapshot__empty">此版本尚未收录食记。</p>
      <ul v-else class="snapshot__food">
        <li v-for="food in plan.foodJournal" :key="food.id">
          <div class="snapshot__spot-head"><h4>{{ food.name }}</h4><span>{{ food.status === 'tasted' ? '已尝' : '想吃' }} · {{ meals[food.meal] }}</span></div>
          <p v-if="food.restaurant || food.city || food.date" class="snapshot__detail">{{ [food.restaurant, food.city, food.date].filter(Boolean).join(' · ') }}</p>
          <p v-if="food.address" class="snapshot__prose">{{ food.address }}</p>
          <p class="snapshot__detail">花费 {{ money(food.cost) }}<span v-if="food.rating"> · 评分 {{ food.rating }} / 5</span></p>
          <p v-if="food.notes" class="snapshot__prose">{{ food.notes }}</p>
          <ul v-if="food.tags.length" class="snapshot__tags" aria-label="食记标签"><li v-for="(tag, index) in food.tags" :key="index">{{ tag }}</li></ul>
        </li>
      </ul>
    </section>

    <section v-if="plan.tips.length" class="snapshot__section" aria-label="出行提示"><h3>出行提示</h3><ul class="snapshot__notes"><li v-for="(tip, index) in plan.tips" :key="index">{{ tip }}</li></ul></section>
    <section v-if="plan.checklist.length" class="snapshot__section" aria-label="出行清单"><h3>出行清单</h3><ul class="snapshot__checklist"><li v-for="item in plan.checklist" :key="item.id"><span>{{ item.done ? '已完成' : '待完成' }}</span>{{ item.text }}</li></ul></section>
  </article>
</template>

<style scoped>
.snapshot { display: grid; gap: 24px; color: var(--text-primary); font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; }
.snapshot h3, .snapshot h4, .snapshot p { margin: 0; }
.snapshot h3 { font-family: var(--font-serif); font-size: 18px; font-weight: 500; }
.snapshot h4 { font-size: 14px; font-weight: 600; }
.snapshot__overview { display: grid; gap: 10px; padding: 20px; background: var(--bg-card-muted); border: 1px solid var(--border-primary); border-left: 3px solid var(--gold-deep); border-radius: 4px; }
.snapshot__overview h3 { font-size: 22px; }
.snapshot__cover { width: 100%; max-height: 220px; object-fit: cover; border-radius: 3px; }
.snapshot__spot-image { width: min(100%, 320px); max-height: 160px; margin-top: 8px; object-fit: cover; border-radius: 3px; }
.snapshot__eyebrow { color: var(--gold-deep); font-size: 11px; letter-spacing: 0.12em; }
.snapshot__stats, .snapshot__day-head, .snapshot__spot-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 16px; }
.snapshot__stats { color: var(--bamboo); }
.snapshot__section { display: grid; gap: 12px; }
.snapshot__section > h3 { padding-bottom: 8px; border-bottom: 1px solid var(--border-primary); }
.snapshot__day { border: 1px solid var(--border-primary); border-radius: 4px; overflow: hidden; }
.snapshot__day-head { padding: 12px 16px; background: var(--bg-card-muted); }
.snapshot__day-head strong { color: var(--cinnabar); font-family: var(--font-serif); font-size: 16px; }
.snapshot__day-head time { color: var(--text-muted); font-size: 12px; }
.snapshot__spots { margin: 0; padding: 0 16px 0 40px; }
.snapshot__spots > li { padding: 14px 0; border-bottom: 1px dashed var(--border-primary); }
.snapshot__spots > li::marker { color: var(--gold-deep); }
.snapshot__spot-head > span, .snapshot__spot-head > time, .snapshot__detail { color: var(--text-muted); font-size: 12px; }
.snapshot__prose, .snapshot__notes li, .snapshot__logistics dd { white-space: pre-wrap; }
.snapshot__logistics { display: grid; gap: 8px; margin: 0; padding: 14px 16px; }
.snapshot__logistics > div { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 12px; }
.snapshot__logistics dt { color: var(--text-secondary); }
.snapshot__logistics dd { margin: 0; }
.snapshot__logistics ul { margin: 0; padding-left: 16px; }
.snapshot__budget { display: grid; gap: 8px; margin: 0; }
.snapshot__budget > div { display: flex; justify-content: space-between; gap: 16px; }
.snapshot__budget dd { margin: 0; white-space: nowrap; }
.snapshot__budget > div:first-child { color: var(--cinnabar); font-weight: 600; }
.snapshot__food, .snapshot__tags, .snapshot__checklist { list-style: none; padding: 0; margin: 0; }
.snapshot__food { display: grid; gap: 12px; }
.snapshot__food > li { display: grid; gap: 4px; padding: 14px 16px; border: 1px solid var(--border-primary); border-radius: 4px; }
.snapshot__tags { display: flex; flex-wrap: wrap; gap: 6px; }
.snapshot__tags li { padding: 1px 8px; background: var(--bg-card-muted); border: 1px solid var(--border-primary); border-radius: 3px; font-size: 11px; }
.snapshot__checklist { display: grid; gap: 8px; }
.snapshot__checklist li { display: flex; align-items: baseline; gap: 12px; }
.snapshot__checklist span { flex-shrink: 0; color: var(--text-muted); font-size: 11px; }
.snapshot__notes { margin: 0; padding-left: 20px; }
.snapshot__empty { color: var(--text-muted); }
.snapshot__day > .snapshot__empty { padding: 12px 16px 0; }
@media (max-width: 520px) { .snapshot__overview { padding: 14px; } .snapshot__overview h3 { font-size: 20px; } .snapshot__stats { gap: 4px 12px; } }
</style>

<script setup lang="ts">
import { api } from '~/utils/api'

definePageMeta({ middleware: 'admin', keepalive: true })

type Stats = Awaited<ReturnType<typeof api.admin.stats>>
type AdminUser = Awaited<ReturnType<typeof api.admin.users>>[number]
type AdminPlan = Awaited<ReturnType<typeof api.admin.plans>>[number]
type CacheData = Awaited<ReturnType<typeof api.admin.cache>>

const { user, loadMe, clearUser } = useCurrentUser()
const { resetWorkspace } = useWorkspace()

const tab = ref<'overview' | 'users' | 'plans' | 'cache'>('overview')
const stats = ref<Stats | null>(null)
const users = ref<AdminUser[]>([])
const plans = ref<AdminPlan[]>([])
const cacheData = ref<CacheData | null>(null)
const message = ref('')
const loading = ref(false)
const serviceName: Record<string, string> = { ai: 'AI 模型', staticmap: '静态地图', panorama: '街景' }
const statusName: Record<string, string> = { queued: '等待中', running: '生成中', completed: '已完成', cancelled: '已停止', failed: '失败', interrupted: '重启中断' }

async function loadTab() {
  loading.value = true
  try {
    if (tab.value === 'overview') stats.value = await api.admin.stats()
    if (tab.value === 'users') users.value = await api.admin.users()
    if (tab.value === 'plans') plans.value = await api.admin.plans()
    if (tab.value === 'cache') cacheData.value = await api.admin.cache()
  } finally {
    loading.value = false
  }
}

watch(tab, () => void loadTab(), { immediate: true })
onMounted(() => void loadMe())

// KeepAlive 返回时刷新数据（首次激活跳过，避免与 onMounted / watch 重复请求）
let activatedOnce = false
onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  void loadTab()
  void loadMe(true)
})

async function toggleRole(item: AdminUser) {
  await api.admin.updateUser(item.id, { role: item.role === 'admin' ? 'user' : 'admin' })
  await loadTab()
}

async function toggleBan(item: AdminUser) {
  await api.admin.updateUser(item.id, { banned: !item.banned })
  await loadTab()
}

async function removePlan(item: AdminPlan) {
  if (!window.confirm(`删除规划「${item.title}」？`)) return
  await api.admin.deletePlan(item.id)
  await loadTab()
}

async function clearCache() {
  if (!window.confirm('清空全部后端缓存（Nitro storage + SQLite cache 表）？')) return
  const result = await api.admin.clearCache()
  message.value = `已清理 ${result.removed} 条缓存`
  await loadTab()
}

async function logout() {
  resetWorkspace()
  clearUser()
  await signOut()
  await navigateTo('/login')
}
</script>

<template>
  <div class="admin">
    <header class="admin__topbar">
      <div class="admin__brand"><span class="admin__seal">山</span> 山海行笺 · 管理后台</div>
      <div class="admin__topbar-right">
        <NuxtLink to="/" class="admin__link">返回工作台</NuxtLink>
        <span class="admin__user">{{ user?.email }}</span>
        <button class="admin__link" @click="logout">退出</button>
      </div>
    </header>

    <nav class="admin__tabs">
      <button :class="{ active: tab === 'overview' }" @click="tab = 'overview'">概览</button>
      <button :class="{ active: tab === 'users' }" @click="tab = 'users'">用户</button>
      <button :class="{ active: tab === 'plans' }" @click="tab = 'plans'">规划</button>
      <button :class="{ active: tab === 'cache' }" @click="tab = 'cache'">缓存</button>
    </nav>

    <main class="admin__body">
      <p v-if="loading" class="admin__loading">加载中…</p>

      <section v-if="tab === 'overview' && stats" class="admin__stats">
        <div class="stat-card"><span class="stat-card__value">{{ stats.plans }}</span><span class="stat-card__label">规划</span></div>
        <div class="stat-card"><span class="stat-card__value">{{ stats.conversations }}</span><span class="stat-card__label">会话</span></div>
        <div class="stat-card"><span class="stat-card__value">{{ stats.messages }}</span><span class="stat-card__label">消息</span></div>
        <div class="stat-card"><span class="stat-card__value">{{ stats.cache.total }}</span><span class="stat-card__label">缓存条目</span></div>
        <div class="stat-card"><span class="stat-card__value">{{ formatBytes(stats.cache.bytes) }}</span><span class="stat-card__label">缓存体积</span></div>
        <div v-for="run in stats.runs" :key="run.status" class="stat-card"><span class="stat-card__value">{{ run.count }}</span><span class="stat-card__label">{{ statusName[run.status] || run.status }}</span></div>
      </section>

      <section v-if="tab === 'overview' && stats" class="admin__table-wrap">
        <h2>实际服务用量</h2>
        <p class="admin__loading">自指标启用起累计；缓存命中单独统计。Token 仅累计供应商返回的用量，未报告的调用不作估算。</p>
        <table class="admin__table">
          <thead><tr><th>服务</th><th>外部请求</th><th>失败</th><th>缓存命中</th><th>平均耗时</th><th>输入 / 输出 Token</th><th>用量已知调用</th></tr></thead>
          <tbody><tr v-for="metric in stats.metrics" :key="metric.service">
            <td>{{ serviceName[metric.service] || metric.service }}</td><td>{{ metric.requests }}</td><td>{{ metric.errors }}</td><td>{{ metric.cacheHits }}</td>
            <td>{{ metric.requests ? `${Math.round(metric.durationMs / metric.requests)} ms` : '—' }}</td>
            <td>{{ metric.usageSamples ? `${metric.inputTokens} / ${metric.outputTokens}` : '未知' }}</td><td>{{ metric.usageSamples }} / {{ metric.requests }}</td>
          </tr></tbody>
        </table>
        <h2>最近生成任务</h2>
        <table class="admin__table">
          <thead><tr><th>请求编号</th><th>规划</th><th>状态</th><th>完成步骤</th><th>更新时间</th><th>错误类型</th></tr></thead>
          <tbody><tr v-for="run in stats.recentRuns" :key="`${run.conversationId}-${run.requestId}`">
            <td class="admin__key">{{ run.requestId }}</td><td>{{ run.planId }}</td><td>{{ statusName[run.status] || run.status }}</td><td>{{ run.steps }}</td><td>{{ formatDateTime(run.updatedAt) }}</td><td>{{ run.errorCode || '—' }}</td>
          </tr></tbody>
        </table>
      </section>

      <section v-if="tab === 'users'" class="admin__table-wrap">
        <table class="admin__table">
          <thead>
            <tr><th>邮箱</th><th>昵称</th><th>角色</th><th>规划</th><th>注册时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in users" :key="item.id">
              <td>{{ item.email }}</td>
              <td>{{ item.name }}</td>
              <td>
                <span class="admin__badge" :class="{ 'admin__badge--seal': item.role === 'admin' }">
                  {{ item.role === 'admin' ? '管理员' : '用户' }}
                </span>
              </td>
              <td>{{ item.planCount }}</td>
              <td>{{ formatDateTime(item.createdAt) }}</td>
              <td class="admin__actions">
                <button class="btn btn--ghost btn--small" @click="toggleRole(item)">
                  {{ item.role === 'admin' ? '降为用户' : '设为管理员' }}
                </button>
                <button class="btn btn--ghost btn--small" @click="toggleBan(item)">
                  {{ item.banned ? '解封' : '封禁' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <section v-if="tab === 'plans'" class="admin__table-wrap">
        <table class="admin__table">
          <thead>
            <tr><th>标题</th><th>简介</th><th>用户</th><th>更新时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in plans" :key="item.id">
              <td>{{ item.title }}</td>
              <td class="admin__ellipsis">{{ item.summary }}</td>
              <td>{{ item.userEmail }}</td>
              <td>{{ formatDateTime(item.updatedAt) }}</td>
              <td class="admin__actions">
                <button class="btn btn--ghost btn--small" @click="removePlan(item)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="tab === 'cache' && cacheData" class="admin__cache">
        <div class="admin__cache-head">
          <span>共 {{ cacheData.stats.total }} 条（过期 {{ cacheData.stats.expired }}），{{ formatBytes(cacheData.stats.bytes) }}</span>
          <button class="btn btn--seal btn--small" @click="clearCache">清空缓存</button>
        </div>
        <p v-if="message" class="admin__loading">{{ message }}</p>
        <table class="admin__table">
          <thead>
            <tr><th>Key</th><th>类型</th><th>大小</th><th>过期时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="entry in cacheData.entries" :key="entry.key">
              <td class="admin__key">{{ entry.key }}</td>
              <td>{{ entry.type }}</td>
              <td>{{ formatBytes(entry.size) }}</td>
              <td :class="{ 'admin__expired': entry.expired }">{{ formatDateTime(entry.expiresAt) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  </div>
</template>

<style scoped>
.admin {
  min-height: 100vh;
  background: var(--paper-deep);
}
.admin__topbar {
  height: var(--topbar-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: var(--paper);
  color: var(--ink);
  border-bottom: 1px solid var(--line);
}
.admin__brand {
  font-family: var(--font-serif);
  font-size: 17px;
  letter-spacing: 0.2em;
  display: flex;
  align-items: center;
  gap: 8px;
}
.admin__seal {
  width: 24px;
  height: 24px;
  background: var(--cinnabar);
  color: var(--paper-white);
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}
.admin__topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.admin__user {
  font-size: 12px;
  color: var(--ink-faint);
}
.admin__link {
  background: none;
  border: 1px solid var(--line);
  color: var(--ink-soft);
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 3px;
  cursor: pointer;
  text-decoration: none;
}
.admin__link:hover {
  border-color: var(--gold);
  color: var(--gold);
}
.admin__tabs {
  display: flex;
  gap: 4px;
  padding: 12px 20px 0;
}
.admin__tabs button {
  border: 1px solid var(--line);
  border-bottom: none;
  background: var(--paper-deep);
  color: var(--ink-soft);
  font-family: var(--font-serif);
  font-size: 13px;
  padding: 6px 18px;
  border-radius: 4px 4px 0 0;
  cursor: pointer;
}
.admin__tabs button.active {
  background: var(--paper);
  color: var(--cinnabar);
}
.admin__body {
  background: var(--paper);
  border-top: 1px solid var(--line);
  padding: 20px;
  min-height: calc(100vh - 120px);
}
.admin__loading {
  color: var(--ink-faint);
  font-size: 13px;
}
.admin__stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}
.stat-card {
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--paper-deep);
  padding: 14px;
  display: grid;
  gap: 6px;
}
.stat-card__value {
  font-family: var(--font-serif);
  font-size: 22px;
  color: var(--cinnabar);
}
.stat-card__label {
  font-size: 12px;
  color: var(--ink-faint);
  letter-spacing: 0.15em;
}
.admin__table-wrap,
.admin__cache {
  overflow-x: auto;
}
.admin__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.admin__table th {
  text-align: left;
  font-family: var(--font-serif);
  font-weight: 500;
  color: var(--ink-soft);
  border-bottom: 2px solid var(--line);
  padding: 8px 10px;
  white-space: nowrap;
}
.admin__table td {
  border-bottom: 1px dashed var(--line-soft);
  padding: 8px 10px;
  color: var(--ink);
  vertical-align: middle;
}
.admin__badge {
  font-size: 11px;
  border: 1px solid var(--bamboo);
  color: var(--bamboo);
  border-radius: 3px;
  padding: 1px 6px;
}
.admin__badge--seal {
  border-color: var(--cinnabar);
  color: var(--cinnabar);
}
.admin__actions {
  display: flex;
  gap: 6px;
}
.admin__ellipsis,
.admin__key {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.admin__key {
  font-family: Consolas, monospace;
  font-size: 11px;
  color: var(--ink-faint);
}
.admin__expired {
  color: var(--cinnabar);
}
.admin__cache-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 13px;
  color: var(--ink-soft);
}
</style>

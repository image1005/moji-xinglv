<script setup lang="ts">
const route = useRoute()

const mode = ref<'signin' | 'signup'>('signin')
const email = ref('')
const password = ref('')
const name = ref('')
const message = ref('')
const busy = ref(false)

async function redirectByRole(user: { role?: string | null }) {
  const redirect = (route.query.redirect as string) || ''
  await navigateTo(user.role === 'admin' ? '/admin' : redirect || '/')
}

onMounted(async () => {
  const session = await authClient.getSession()
  if (session.data?.user) await redirectByRole(session.data.user as { role?: string | null })
})

async function submit() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    if (mode.value === 'signin') {
      const result = await signIn.email({ email: email.value, password: password.value })
      if (result.error) {
        message.value = result.error.message ?? '登录失败'
        return
      }
    } else {
      const result = await signUp.email({
        email: email.value,
        password: password.value,
        name: name.value || email.value,
      })
      if (result.error) {
        message.value = result.error.message ?? '注册失败'
        return
      }
    }
    const session = await authClient.getSession()
    const user = session.data?.user as { role?: string | null } | undefined
    if (!user) {
      message.value = '登录状态获取失败，请重试'
      return
    }
    await redirectByRole(user)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login">
    <div class="login__card">
      <div class="login__brand">
        <span class="login__seal">墨</span>
        <h1>墨迹行旅</h1>
        <p>国风行程规划智能体</p>
      </div>
      <div class="login__tabs">
        <button :class="{ active: mode === 'signin' }" @click="mode = 'signin'">登录</button>
        <button :class="{ active: mode === 'signup' }" @click="mode = 'signup'">注册</button>
      </div>
      <form class="login__form" @submit.prevent="submit">
        <label v-if="mode === 'signup'">
          昵称
          <input v-model="name" type="text" autocomplete="nickname" placeholder="如何称呼你">
        </label>
        <label>
          邮箱
          <input v-model="email" type="email" autocomplete="email" placeholder="you@example.com" required>
        </label>
        <label>
          密码
          <input
            v-model="password"
            type="password"
            :autocomplete="mode === 'signin' ? 'current-password' : 'new-password'"
            placeholder="至少 6 位"
            required
          >
        </label>
        <button class="btn btn--seal login__submit" :disabled="busy" type="submit">
          {{ mode === 'signin' ? '入内' : '开户' }}
        </button>
      </form>
      <p v-if="message" class="login__message">{{ message }}</p>
      <p class="login__hint">
        初始管理员由 <code>bun run db:seed</code> 创建
        （默认 admin@example.com / admin123456，登录后自动进入后台）。
      </p>
    </div>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 20% 20%, rgba(200, 164, 92, 0.08), transparent 45%),
    radial-gradient(circle at 80% 70%, rgba(74, 114, 100, 0.08), transparent 45%),
    var(--paper-deep);
  padding: 20px;
}
.login__card {
  width: min(92vw, 380px);
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 12px 40px rgba(43, 43, 43, 0.12);
  padding: 28px 26px 20px;
}
.login__brand {
  text-align: center;
  margin-bottom: 18px;
}
.login__seal {
  display: inline-flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  background: var(--cinnabar);
  color: var(--paper);
  font-family: var(--font-serif);
  font-size: 22px;
  border-radius: 4px;
  margin-bottom: 8px;
}
.login__brand h1 {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 24px;
  letter-spacing: 0.3em;
  color: var(--ink);
}
.login__brand p {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ink-faint);
  letter-spacing: 0.2em;
}
.login__tabs {
  display: flex;
  border-bottom: 1px solid var(--line);
  margin-bottom: 16px;
}
.login__tabs button {
  flex: 1;
  background: none;
  border: none;
  padding: 8px 0 10px;
  font-size: 14px;
  font-family: var(--font-serif);
  color: var(--ink-faint);
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.login__tabs button.active {
  color: var(--cinnabar);
  border-bottom-color: var(--cinnabar);
}
.login__form {
  display: grid;
  gap: 12px;
}
.login__form label {
  display: grid;
  gap: 5px;
  font-size: 12px;
  color: var(--ink-soft);
  letter-spacing: 0.1em;
}
.login__form input {
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--paper-deep);
  padding: 8px 10px;
  font-size: 14px;
  color: var(--ink);
  font-family: inherit;
}
.login__form input:focus {
  outline: none;
  border-color: var(--bamboo);
}
.login__submit {
  margin-top: 4px;
}
.login__message {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--cinnabar);
}
.login__hint {
  margin: 16px 0 0;
  font-size: 11px;
  color: var(--ink-faint);
  line-height: 1.7;
  border-top: 1px dashed var(--line-soft);
  padding-top: 10px;
}
.login__hint code {
  background: var(--paper-deep);
  padding: 0 3px;
  border-radius: 2px;
}
</style>

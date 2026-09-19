<script setup lang="ts">
const route = useRoute()
const { loadMe } = useCurrentUser()
const mode = ref<'signin' | 'signup'>('signin')
const email = ref('')
const password = ref('')
const name = ref('')
const message = ref('')
const success = ref(false)
const busy = ref(false)

async function redirectByRole(user: { role?: string | null }) {
  const candidate = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  const redirect = candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.includes('\\') && !candidate.startsWith('/login') ? candidate : '/'
  await loadMe(true)
  await navigateTo(user.role === 'admin' ? '/admin' : redirect)
}

onMounted(async () => {
  try {
    const session = await authClient.getSession()
    if (session.data?.user) await redirectByRole(session.data.user as { role?: string | null })
  } catch {
    message.value = '暂时无法确认登录状态，你仍可以尝试登录。'
  }
})

function switchMode(value: 'signin' | 'signup') {
  if (busy.value) return
  mode.value = value
  message.value = ''
  success.value = false
}

function authError(code: string | undefined, fallback: string) {
  if (code === 'INVALID_EMAIL_OR_PASSWORD' || code === 'INVALID_PASSWORD') return '邮箱或密码不正确，请检查后重试。'
  if (code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') return '这个邮箱已注册，请切换到登录。'
  if (code === 'PASSWORD_TOO_SHORT') return '密码至少需要 6 位，请重新设置。'
  if (code === 'PASSWORD_TOO_LONG') return '密码长度不能超过 128 位。'
  if (code === 'INVALID_EMAIL') return '请输入有效的邮箱地址。'
  if (code === 'USER_BANNED') return '当前账户不可用，请联系管理员。'
  return fallback
}

async function submit() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  success.value = false
  try {
    if (mode.value === 'signin') {
      const result = await signIn.email({ email: email.value.trim(), password: password.value })
      if (result.error) {
        message.value = authError(result.error.code, result.error.message ?? '登录未完成，请重试。')
        return
      }
    } else {
      const result = await signUp.email({ email: email.value.trim(), password: password.value, name: name.value.trim() || email.value.trim().split('@')[0] || '旅人' })
      if (result.error) {
        message.value = authError(result.error.code, result.error.message ?? '注册未完成，请重试。')
        return
      }
    }
    const session = await authClient.getSession()
    const user = session.data?.user as { role?: string | null } | undefined
    if (!user) {
      message.value = mode.value === 'signup' ? '注册已完成，请使用刚才的邮箱与密码登录。' : '暂时无法获取登录状态，请重试。'
      if (mode.value === 'signup') {
        success.value = true
        mode.value = 'signin'
      }
      return
    }
    success.value = true
    message.value = mode.value === 'signup' ? '注册成功，正在为你翻开第一份行笺…' : '登录成功，正在返回你的行笺…'
    await redirectByRole(user)
  } catch {
    success.value = false
    message.value = '连接暂未完成，请检查网络后重试。已填写的内容会保留。'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="login">
    <div class="login__layout">
      <section class="login__story" aria-label="山海行笺">
        <div class="login__brand"><BrandMark :size="58" decorative /><div><h1>山海行笺</h1><p>AI 旅行规划</p></div></div>
        <div class="login__verse"><p class="eyebrow">心有所向 · 山海可往</p><h2>把远方，<br>写进日常。</h2><p>从一念向往，到一路风景。<br>你的旅行知己，陪你把每一程细细安排。</p><div class="login__signature"><span />行有所思 · 旅有所记</div></div>
        <div class="login__window" aria-hidden="true"><span /><AppIcon name="mountain" :size="100" /></div>
        <p class="login__story-foot">一笺山海，万般自在。</p>
      </section>
      <section class="login__card" :aria-busy="busy">
        <p class="eyebrow">{{ mode === 'signin' ? '故人归来' : '初见山海' }}</p>
        <h2>{{ mode === 'signin' ? '欢迎回来，旅人。' : '很高兴，与你同程。' }}</h2>
        <p class="login__subtitle">{{ mode === 'signin' ? '登录，继续书写你的山海故事。' : '创建账户，收藏向往的每一处远方。' }}</p>
        <div class="login__tabs" role="tablist" aria-label="登录或注册"><button :class="{ active: mode === 'signin' }" role="tab" :aria-selected="mode === 'signin'" :disabled="busy" @click="switchMode('signin')">登录</button><button :class="{ active: mode === 'signup' }" role="tab" :aria-selected="mode === 'signup'" :disabled="busy" @click="switchMode('signup')">注册</button></div>
        <form class="login__form" @submit.prevent="submit">
          <label v-if="mode === 'signup'" class="field">旅人称呼 <span class="login__optional">选填</span><input v-model="name" type="text" autocomplete="nickname" maxlength="80" placeholder="如何称呼你" :disabled="busy"></label>
          <label class="field">邮箱地址<input v-model="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required :disabled="busy"></label>
          <label class="field">密码<input v-model="password" type="password" :autocomplete="mode === 'signin' ? 'current-password' : 'new-password'" :placeholder="mode === 'signup' ? '设置至少 6 位密码' : '请输入登录密码'" :minlength="mode === 'signup' ? 6 : undefined" maxlength="128" required :disabled="busy"></label>
          <p v-if="message" class="feedback" :class="{ 'feedback--success': success }" :role="success ? 'status' : 'alert'">{{ message }}</p>
          <button class="btn btn--seal login__submit" :disabled="busy" type="submit"><span>{{ busy ? '正在为你翻开行笺…' : mode === 'signin' ? '登录，启程' : '注册，开启山海之旅' }}</span><AppIcon v-if="!busy" name="arrow" :size="16" /></button>
        </form>
        <p class="login__hint"><AppIcon name="book" :size="13" />你的行程、对话与旅行偏好，随账户妥善留存。</p>
      </section>
    </div>
    <p class="login__footer">山海行笺 · 让每一程，都有自己的模样</p>
  </main>
</template>

<style scoped>
.login { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 52px 28px 30px; background: var(--paper-deep); }
.login__layout { display: grid; grid-template-columns: 1.08fr 1fr; width: min(100%, 1040px); min-height: 650px; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--paper-white); box-shadow: 0 18px 65px rgb(52 61 39 / 5%); }
.login__story { position: relative; overflow: hidden; padding: 47px 52px; border-right: 1px solid var(--line); background: #f4f4ec; }
.login__brand { display: flex; align-items: center; gap: 15px; }
.login__brand h1 { margin: 0 0 5px; font-size: 24px; font-weight: 500; letter-spacing: 0.18em; }
.login__brand p { margin: 0; font-size: 10px; color: var(--ink-faint); letter-spacing: 0.22em; }
.login__verse { position: relative; z-index: 1; margin-top: 81px; }
.login__verse h2 { margin: 21px 0; font-size: 52px; font-weight: 400; letter-spacing: 0.08em; line-height: 1.45; }
.login__verse > p:not(.eyebrow) { margin: 0; color: var(--ink-soft); font-size: 12px; line-height: 2.1; }
.login__signature { display: flex; align-items: center; gap: 12px; margin-top: 29px; color: var(--gold-deep); font-family: var(--font-serif); font-size: 11px; letter-spacing: 0.1em; }
.login__signature > span { width: 25px; height: 1px; background: var(--gold); }
.login__window { position: absolute; bottom: 59px; right: -63px; width: 235px; height: 235px; border: 1px solid #dfdfce; border-radius: 50%; display: grid; place-items: center; color: #b5bca8; }
.login__window::before { content: ''; position: absolute; inset: 9px; border: 1px solid #e2e2d3; border-radius: 50%; }
.login__window > span { position: absolute; width: 146px; height: 170px; border-right: 1px solid #e0e1d3; border-left: 1px solid #e0e1d3; }
.login__window > span::after { content: ''; position: absolute; top: 30px; bottom: 30px; left: -19px; right: -19px; border-top: 1px solid #e0e1d3; border-bottom: 1px solid #e0e1d3; }
.login__window .app-icon { position: relative; z-index: 1; padding: 11px; background: #f4f4ec; }
.login__story-foot { position: relative; z-index: 1; margin: 65px 0 0; color: #a0a18f; font-family: var(--font-serif); font-size: 11px; letter-spacing: 0.12em; }
.login__card { padding: 63px 55px 40px; display: flex; flex-direction: column; justify-content: center; }
.login__card > h2 { margin: 12px 0 11px; font-size: 27px; font-weight: 500; letter-spacing: 0.04em; }
.login__subtitle { margin: 0; color: var(--ink-faint); font-size: 12px; line-height: 1.8; }
.login__tabs { display: flex; gap: 29px; border-bottom: 1px solid var(--line); margin: 29px 0 25px; }
.login__tabs button { border: 0; border-bottom: 2px solid transparent; background: none; padding: 0 1px 12px; font-size: 13px; color: var(--ink-faint); cursor: pointer; }
.login__tabs button.active { color: var(--cinnabar); border-bottom-color: var(--cinnabar); }
.login__form { display: grid; gap: 20px; }
.login__form .field { position: relative; gap: 9px; font-size: 11px; }
.login__form .field input { padding: 11px 13px; background: var(--paper); font-size: 12px; }
.login__optional { position: absolute; top: 0; right: 0; color: var(--ink-faint); font-size: 10px; }
.login__submit { min-height: 44px; justify-content: space-between; margin-top: 5px; padding: 11px 15px; font-size: 12px; letter-spacing: 0.04em; }
.login__hint { display: flex; align-items: flex-start; gap: 7px; margin: 26px 0 0; font-size: 10px; color: var(--ink-faint); line-height: 1.9; }
.login__hint .app-icon { margin-top: 3px; }
.login__footer { margin: 26px 0 0; color: #999b8c; font-size: 10px; letter-spacing: 0.13em; }
@media (max-width: 900px) { .login__story { padding: 37px; } .login__card { padding: 45px 34px; } .login__verse h2 { font-size: 45px; } .login__window { opacity: 0.65; } }
@media (max-width: 680px) { .login { padding: 26px 18px; } .login__layout { width: min(100%, 430px); grid-template-columns: 1fr; min-height: auto; } .login__story { padding: 28px 32px; border-right: 0; border-bottom: 1px solid var(--line); } .login__verse, .login__window, .login__story-foot { display: none; } .login__card { padding: 34px 32px; } .login__card > h2 { font-size: 25px; } .login__footer { font-size: 9px; } }
</style>

<script setup lang="ts">
const route = useRoute()
const { loadMe } = useCurrentUser()
const mode = ref<'signin' | 'signup'>('signin')
const slideDirection = ref<'slide-left' | 'slide-right'>('slide-left')
const tabSignin = ref<HTMLElement | null>(null)
const tabSignup = ref<HTMLElement | null>(null)
const email = ref('')
const password = ref('')
const message = ref('')
const success = ref(false)
const busy = ref(false)

interface Slide {
  url: string
  title: string
  region: string
  poem: string
}

const slides: Slide[] = [
  { url: '/slides/yungang.webp', title: '云冈石窟', region: '大同', poem: '石凿千佛像，光映万代心' },
  { url: '/slides/wutaishan.webp', title: '五台山', region: '忻州', poem: '翠微连五顶，梵刹锁云烟' },
  { url: '/slides/yingxian.webp', title: '应县木塔', region: '朔州', poem: '凌虚依斗极，拔地傲风霜' },
  { url: '/slides/taiyuan.webp', title: '太原古县城', region: '太原', poem: '城开晋阳月，灯点万家春' },
  { url: '/slides/yunqiushan.webp', title: '云丘山', region: '临汾', poem: '千峰耸翠色，百步入仙源' },
  { url: '/slides/dazhai.webp', title: '昔阳大寨', region: '晋中', poem: '梯田层层碧，青山处处歌' },
  { url: '/slides/taihang-cave.webp', title: '太行溶洞', region: '长治', poem: '钟乳凝岁月，石室隐琼瑶' },
  { url: '/slides/dahuaishu.webp', title: '洪洞大槐树', region: '临汾', poem: '问我祖先何处来，大槐树下梦魂牵' },
  { url: '/slides/taihang-memorial.webp', title: '太行纪念馆', region: '长治', poem: '巍巍太行脊，赤胆映长天' },
]

const currentSlide = ref(0)
let slideTimer: ReturnType<typeof setInterval> | null = null

function nextSlide(manual = false) {
  currentSlide.value = (currentSlide.value + 1) % slides.length
  if (manual) restartTimer()
}

function setSlide(index: number) {
  currentSlide.value = index
  restartTimer()
}

function startTimer() {
  stopTimer()
  slideTimer = setInterval(nextSlide, 7000)
}

function stopTimer() {
  if (slideTimer) {
    clearInterval(slideTimer)
    slideTimer = null
  }
}

function restartTimer() {
  startTimer()
}

async function redirectByRole(user: { role?: string | null }) {
  const candidate = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  const redirect = candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.includes('\\') && !candidate.startsWith('/login') ? candidate : '/'
  await loadMe(true)
  await navigateTo(user.role === 'admin' ? '/admin' : redirect)
}

onMounted(async () => {
  startTimer()
  if (import.meta.client) {
    slides.forEach((s) => {
      const img = new Image()
      img.src = s.url
    })
  }
  try {
    const session = await authClient.getSession()
    if (session.data?.user) await redirectByRole(session.data.user as { role?: string | null })
  } catch {
    message.value = '暂时无法确认登录状态，你仍可以尝试登录。'
  }
})

onUnmounted(() => {
  stopTimer()
})

function switchMode(value: 'signin' | 'signup') {
  if (busy.value || mode.value === value) return
  slideDirection.value = value === 'signup' ? 'slide-left' : 'slide-right'
  mode.value = value
  message.value = ''
  success.value = false
}

const indicatorStyle = computed(() => {
  if (mode.value === 'signup') {
    return {
      transform: tabSignup.value ? `translateX(${tabSignup.value.offsetLeft}px)` : 'translateX(57px)',
      width: tabSignup.value ? `${tabSignup.value.offsetWidth}px` : '30px',
    }
  }
  return {
    transform: tabSignin.value ? `translateX(${tabSignin.value.offsetLeft}px)` : 'translateX(0px)',
    width: tabSignin.value ? `${tabSignin.value.offsetWidth}px` : '30px',
  }
})

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
      const result = await signUp.email({ email: email.value.trim(), password: password.value, name: email.value.trim().split('@')[0] || '旅人' })
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
        slideDirection.value = 'slide-right'
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
    <div class="login__carousel" aria-hidden="true">
      <div
        v-for="(slide, index) in slides"
        :key="slide.url"
        class="login__carousel-slide"
        :class="{ 'is-active': index === currentSlide }"
        :style="{ backgroundImage: `url(${slide.url})` }"
      />
      <div class="login__carousel-overlay" />
    </div>

    <div class="login__layout">
      <section class="login__story" aria-label="山海行笺">
        <div class="login__backdrop" aria-hidden="true">
          <div class="login__backdrop-image" />
          <div class="login__backdrop-overlay" />
        </div>
        <div class="login__brand"><BrandMark :size="58" decorative /><div><h1>山海行笺</h1><p>AI 旅行规划</p></div></div>
        <div class="login__verse"><p class="eyebrow">心有所向 · 山海可往</p><h2>把远方<br>写进日常</h2><p>从一念向往，到一路风景<br>你的旅行知己，陪你把每一程细细安排</p><div class="login__signature"><span />行有所思 · 旅有所记</div></div>
        <div class="login__window" aria-hidden="true"><span /><AppIcon name="mountain" :size="100" /></div>
        <p class="login__story-foot">一笺山海，万般自在</p>
      </section>
      <section class="login__card" :aria-busy="busy">
        <div class="login__header-viewport">
          <Transition :name="slideDirection" mode="out-in">
            <div :key="mode" class="login__header-content">
              <div class="login__header-brand">
                <BrandMark :size="48" decorative />
              </div>
              <p class="eyebrow">{{ mode === 'signin' ? '故人归来' : '初见山海' }}</p>
              <h2>{{ mode === 'signin' ? '欢迎回来，旅人' : '很高兴，与你同程' }}</h2>
              <p class="login__subtitle">{{ mode === 'signin' ? '登录，继续书写你的山海故事' : '创建账户，收藏向往的每一处远方' }}</p>
            </div>
          </Transition>
        </div>
        <div class="login__tabs" role="tablist" aria-label="登录或注册">
          <button
            ref="tabSignin"
            :class="{ active: mode === 'signin' }"
            role="tab"
            :aria-selected="mode === 'signin'"
            :disabled="busy"
            @click="switchMode('signin')"
          >
            登录
          </button>
          <button
            ref="tabSignup"
            :class="{ active: mode === 'signup' }"
            role="tab"
            :aria-selected="mode === 'signup'"
            :disabled="busy"
            @click="switchMode('signup')"
          >
            注册
          </button>
          <span class="login__tabs-indicator" :style="indicatorStyle" aria-hidden="true" />
        </div>
        <div class="login__form-viewport">
          <Transition :name="slideDirection" mode="out-in">
            <form :key="mode" class="login__form" @submit.prevent="submit">
              <label class="field">邮箱地址<input v-model="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required :disabled="busy"></label>
              <label class="field">密码<input v-model="password" type="password" :autocomplete="mode === 'signin' ? 'current-password' : 'new-password'" :placeholder="mode === 'signup' ? '设置至少 6 位密码' : '请输入登录密码'" :minlength="mode === 'signup' ? 6 : undefined" maxlength="128" required :disabled="busy"></label>
              <p v-if="message" class="feedback" :class="{ 'feedback--success': success }" :role="success ? 'status' : 'alert'">{{ message }}</p>
              <button class="btn btn--seal login__submit" :disabled="busy" type="submit">
                <Transition name="btn-text-slide" mode="out-in">
                  <span :key="busy ? 'busy' : mode">{{ busy ? '正在为你翻开行笺…' : mode === 'signin' ? '登录，启程' : '注册，开启山海之旅' }}</span>
                </Transition>
                <AppIcon v-if="!busy" name="arrow" :size="16" class="login__submit-arrow" />
              </button>
            </form>
          </Transition>
        </div>
      </section>
    </div>

    <aside
      class="login__scenic-badge"
      aria-label="当前胜景"
      role="button"
      tabindex="0"
      title="点击欣赏下一处胜景"
      @click="nextSlide(true)"
      @keydown.enter.prevent="nextSlide(true)"
      @keydown.space.prevent="nextSlide(true)"
    >
      <span class="login__scenic-tag">山海所往</span>
      <span class="login__scenic-sep">·</span>
      <div class="login__scenic-viewport">
        <Transition name="scenic-slide" mode="out-in">
          <div :key="currentSlide" class="login__scenic-info">
            <span class="login__scenic-region">{{ slides[currentSlide]?.region }}</span>
            <span class="login__scenic-title">{{ slides[currentSlide]?.title }}</span>
            <span class="login__scenic-poem">{{ slides[currentSlide]?.poem }}</span>
          </div>
        </Transition>
      </div>
    </aside>

    <nav class="login__carousel-nav" aria-label="风景轮播切换">
      <button
        v-for="(slide, idx) in slides"
        :key="idx"
        class="login__carousel-dot"
        :class="{ 'is-active': idx === currentSlide }"
        :title="`${slide.region} · ${slide.title}`"
        :aria-label="`切换到 ${slide.title}`"
        @click="setSlide(idx)"
      />
    </nav>

    <p class="login__footer">山海行笺 · 让每一程，都有自己的模样</p>
  </main>
</template>

<style scoped>
.login {
  position: relative;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  max-height: 100vh;
  max-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  background: var(--paper-deep);
  overflow: hidden;
}

.login__carousel {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}
.login__carousel-slide {
  position: absolute;
  inset: -24px;
  background-size: cover;
  background-position: center 38%;
  opacity: 0;
  transform: scale(1.0);
  filter: saturate(1.1) contrast(1.04);
  transition: opacity 2s cubic-bezier(0.4, 0, 0.2, 1), transform 9s ease-out;
  will-change: opacity, transform;
}
.login__carousel-slide.is-active {
  opacity: 1;
  transform: scale(1.035);
}
.login__carousel-overlay {
  display: none;
}

.login__layout {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1.08fr 1fr;
  width: min(100%, 1040px);
  max-height: min(650px, calc(100vh - 64px));
  min-height: min(580px, calc(100vh - 64px));
  overflow: hidden;
  border: 0;
  border-radius: 12px;
  background: #faf6ee;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.32), 0 2px 10px rgba(0, 0, 0, 0.15);
}

.login__story {
  position: relative;
  overflow: hidden;
  padding: 44px 50px;
  border: 0;
  background: #121311;
}
.login__backdrop { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 0; }
.login__backdrop-image { position: absolute; inset: 0; background-image: url('/brand/jinci.webp'); background-size: cover; background-position: center 30%; opacity: 1; filter: none; }
.login__backdrop-overlay { display: none; }
.login__brand { position: relative; z-index: 1; display: flex; align-items: center; gap: 15px; }
.login__brand h1 { margin: 0 0 5px; font-size: 24px; font-weight: 500; letter-spacing: 0.18em; color: #ffffff; text-shadow: 0 2px 6px rgba(0, 0, 0, 0.75); }
.login__brand p { margin: 0; font-size: 10px; color: rgba(255, 255, 255, 0.85); letter-spacing: 0.22em; font-weight: 400; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.75); }
.login__verse { position: relative; z-index: 1; margin-top: 76px; }
.login__verse .eyebrow { color: #fbe09b; font-weight: 500; letter-spacing: 0.12em; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8); }
.login__verse h2 { margin: 20px 0; font-size: 52px; font-weight: 500; letter-spacing: 0.08em; line-height: 1.45; color: #ffffff; text-shadow: 0 2px 8px rgba(0, 0, 0, 0.75), 0 4px 18px rgba(0, 0, 0, 0.5); }
.login__verse > p:not(.eyebrow) { margin: 0; color: rgba(255, 255, 255, 0.92); font-size: 12px; line-height: 2.1; font-weight: 400; text-shadow: 0 1px 5px rgba(0, 0, 0, 0.75); }
.login__signature { display: flex; align-items: center; gap: 12px; margin-top: 28px; color: #fbe09b; font-family: var(--font-serif); font-size: 11px; letter-spacing: 0.1em; font-weight: 400; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.75); }
.login__signature > span { width: 25px; height: 1px; background: #fbe09b; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); }
.login__window { display: none; }
.login__story-foot { position: relative; z-index: 1; margin: 56px 0 0; color: rgba(255, 255, 255, 0.85); font-family: var(--font-serif); font-size: 11px; letter-spacing: 0.12em; font-weight: 400; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.75); }

.login__card {
  padding: 55px 50px 36px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: #faf6ee;
}
.login__header-viewport,
.login__form-viewport {
  position: relative;
  width: 100%;
  overflow: hidden;
}
.login__header-content .login__header-brand { display: inline-flex; margin-bottom: 12px; }
.login__header-content .eyebrow { color: var(--cinnabar); }
.login__header-content h2 { margin: 12px 0 11px; font-size: 26px; font-weight: 500; letter-spacing: 0.04em; color: #23211c; }
.login__header-content .login__subtitle { margin: 0; color: #736d62; font-size: 12px; line-height: 1.8; }
.login__tabs {
  position: relative;
  display: flex;
  gap: 29px;
  border-bottom: 1px solid #e7e2d4;
  margin: 26px 0 22px;
}
.login__tabs button {
  position: relative;
  z-index: 1;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  padding: 0 1px 12px;
  font-size: 13px;
  color: #827b6f;
  cursor: pointer;
  outline: none;
  transition: color 0.28s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.login__tabs button:hover:not(:disabled) {
  color: #23211c;
}
.login__tabs button:active:not(:disabled) {
  transform: scale(0.92);
}
.login__tabs button.active {
  color: var(--cinnabar);
  font-weight: 500;
}
.login__tabs-indicator {
  position: absolute;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: var(--cinnabar);
  border-radius: 1px;
  transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1),
              width 0.32s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
  will-change: transform, width;
}

/* 水平滑动转场动效 (Left & Right Slides) */
.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
  transition: opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: opacity, transform;
}

.slide-left-enter-from {
  opacity: 0;
  transform: translateX(28px);
}
.slide-left-leave-to {
  opacity: 0;
  transform: translateX(-28px);
}

.slide-right-enter-from {
  opacity: 0;
  transform: translateX(-28px);
}
.slide-right-leave-to {
  opacity: 0;
  transform: translateX(28px);
}

/* 按钮文案微纵向滑入 */
.btn-text-slide-enter-active,
.btn-text-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn-text-slide-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.btn-text-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.login__form { display: grid; gap: 20px; }
.login__form .field { position: relative; gap: 8px; font-size: 11px; color: #4a453c; }
.login__form .field input,
.login__form input {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 14px !important;
  background: #f3ede0 !important;
  border: 1px solid #e4dccb !important;
  border-radius: 6px !important;
  font-size: 13px !important;
  color: #1a1916 !important;
  outline: none !important;
  transition: all 0.25s ease !important;
}

.login__form .field input:focus,
.login__form input:focus {
  background: #ffffff !important;
  border-color: #8c826c !important;
  box-shadow: 0 0 0 2px rgba(140, 130, 108, 0.2) !important;
  outline: none !important;
}

.login__form input::placeholder {
  color: #9a9487 !important;
}

.login__form input:-webkit-autofill,
.login__form input:-webkit-autofill:hover,
.login__form input:-webkit-autofill:focus {
  -webkit-text-fill-color: #1a1916 !important;
  -webkit-box-shadow: 0 0 0 1000px #f3ede0 inset !important;
  box-shadow: 0 0 0 1000px #f3ede0 inset !important;
  transition: background-color 5000s ease-in-out 0s !important;
}

.login__form input:-webkit-autofill:focus {
  -webkit-box-shadow: 0 0 0 1000px #ffffff inset !important;
  box-shadow: 0 0 0 1000px #ffffff inset !important;
}

.login__submit {
  position: relative;
  min-height: 44px;
  justify-content: space-between;
  margin-top: 5px;
  padding: 11px 16px;
  font-size: 12px;
  letter-spacing: 0.04em;
  overflow: hidden;
  transition: background-color 0.25s cubic-bezier(0.4, 0, 0.2, 1),
              transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.login__submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(172, 77, 60, 0.32);
}

.login__submit:active:not(:disabled) {
  transform: scale(0.975) translateY(1px);
  box-shadow: 0 2px 6px rgba(172, 77, 60, 0.2);
}

/* 水墨微波涟漪效果 (Ink Ripple) */
.login__submit::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.4) 10%, transparent 60%);
  opacity: 0;
  transform: scale(0.4);
  transition: opacity 0.35s ease-out, transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}

.login__submit:active:not(:disabled)::after {
  opacity: 1;
  transform: scale(2.4);
  transition: 0s;
}

.login__submit-arrow {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.login__submit:hover:not(:disabled) .login__submit-arrow {
  transform: translateX(4px);
}

.login__scenic-badge {
  position: fixed;
  bottom: 24px;
  left: 32px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border: 1px solid rgba(210, 208, 195, 0.7);
  border-radius: 20px;
  background: rgba(244, 244, 236, 0.88);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  font-size: 11px;
  color: var(--ink-soft);
  box-shadow: 0 4px 18px rgba(45, 52, 34, 0.06);
  pointer-events: auto;
  letter-spacing: 0.06em;
  cursor: pointer;
  user-select: none;
  transition: opacity 0.4s ease,
              transform 0.28s cubic-bezier(0.16, 1, 0.3, 1),
              border-color 0.28s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.28s cubic-bezier(0.16, 1, 0.3, 1),
              background 0.28s ease;
}

.login__scenic-badge:hover {
  transform: translateY(-2px);
  border-color: rgba(181, 154, 103, 0.55);
  background: rgba(248, 248, 242, 0.94);
  box-shadow: 0 8px 24px rgba(45, 52, 34, 0.12), 0 0 0 1px rgba(181, 154, 103, 0.2);
}

.login__scenic-badge:active {
  transform: scale(0.975) translateY(0);
  box-shadow: 0 2px 10px rgba(45, 52, 34, 0.08);
}

.login__scenic-badge:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--cinnabar), 0 4px 18px rgba(45, 52, 34, 0.1);
}

.login__scenic-tag {
  color: var(--cinnabar);
  font-family: var(--font-serif);
  font-size: 10px;
  letter-spacing: 0.12em;
  flex-shrink: 0;
}

.login__scenic-sep {
  color: var(--ink-faint);
  flex-shrink: 0;
}

.login__scenic-viewport {
  position: relative;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
}

.login__scenic-info {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}

.login__scenic-region {
  color: var(--gold-deep);
  font-family: var(--font-serif);
  font-weight: 500;
}

.login__scenic-title {
  font-weight: 500;
  color: var(--ink);
}

.login__scenic-poem {
  margin-left: 4px;
  color: var(--ink-faint);
  font-style: italic;
  font-family: var(--font-serif);
  font-size: 10px;
}

/* 胜景题签卷轴浮现淡入淡出动效 (Scenic Rise-In Fade) */
.scenic-slide-enter-active,
.scenic-slide-leave-active {
  transition: opacity 0.45s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: opacity, transform;
}

.scenic-slide-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.scenic-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.login__carousel-nav {
  position: fixed;
  bottom: 24px;
  right: 32px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 16px;
  background: rgba(244, 244, 236, 0.8);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(210, 208, 195, 0.65);
  box-shadow: 0 4px 16px rgba(45, 52, 34, 0.05);
}
.login__carousel-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 0;
  padding: 0;
  background: rgba(160, 161, 143, 0.45);
  cursor: pointer;
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}
.login__carousel-dot:hover {
  background: var(--cinnabar);
  transform: scale(1.2);
}
.login__carousel-dot.is-active {
  width: 18px;
  border-radius: 4px;
  background: var(--cinnabar);
}

.login__footer {
  position: relative;
  z-index: 1;
  margin: 14px 0 0;
  color: rgba(255, 255, 255, 0.85);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7);
  font-size: 10px;
  letter-spacing: 0.13em;
}

@media (max-width: 900px) {
  .login__story { padding: 32px 36px; }
  .login__card { padding: 40px 32px; }
  .login__verse h2 { font-size: 40px; }
  .login__scenic-poem { display: none; }
}

@media (max-width: 680px) {
  .login { height: auto; min-height: 100vh; min-height: 100dvh; max-height: none; overflow-y: auto; padding: 26px 18px; }
  .login__layout { width: min(100%, 430px); grid-template-columns: 1fr; min-height: auto; max-height: none; }
  .login__story { padding: 28px 32px; border-right: 0; border-bottom: 1px solid #e4dccb; }
  .login__backdrop-image { opacity: 0.9; }
  .login__verse, .login__window, .login__story-foot { display: none; }
  .login__card { padding: 34px 32px; }
  .login__card > h2 { font-size: 25px; }
  .login__footer { font-size: 9px; }
  .login__scenic-badge, .login__carousel-nav { display: none; }
}
</style>

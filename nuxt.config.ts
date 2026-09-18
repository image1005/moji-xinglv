export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  modules: ['@nuxtjs/mdc', '@nuxt/eslint'],
  css: ['~/assets/styles/main.scss'],
  typescript: { strict: true, typeCheck: false },
  vite: {
    // shared/ 下通过 Vite 优化的 zod 在 SSR 下会丢命名导出，强制 SSR 内联打包
    ssr: { noExternal: ['zod'] },
  },
  app: {
    head: {
      title: '山海行笺 · AI 旅行规划',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: '国风旅游行程规划智能体：与 AI 对话，生成可保存、可回滚的行程计划' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/brand/shanhai-xingjian.svg' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/brand/favicon-32.png' },
        { rel: 'shortcut icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/brand/apple-touch-icon.png' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600&display=swap' },
      ],
      htmlAttrs: { lang: 'zh-CN' },
    },
  },
})

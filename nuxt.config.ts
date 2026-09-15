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
      htmlAttrs: { lang: 'zh-CN' },
    },
  },
})

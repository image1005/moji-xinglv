export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  runtimeConfig: {
    public: { baiduMapBrowserAk: '' },
  },
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
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/brand/favicon-32.png?v=3' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/brand/favicon-16.png?v=3' },
        { rel: 'shortcut icon', href: '/favicon.ico?v=3' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/brand/apple-touch-icon.png?v=3' },
      ],
      htmlAttrs: { lang: 'zh-CN' },
      script: [
        {
          tagPosition: 'head',
          innerHTML: `(function(){try{var m=document.cookie.match(/shanhai_theme=([^;]+)/);var s=m?decodeURIComponent(m[1].trim()):localStorage.getItem('shanhai_theme');var t=(s==='dark'||s==='light')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
        },
      ],
    },
  },
})

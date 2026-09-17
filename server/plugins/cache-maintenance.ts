import { maintainCache } from '../services/cache'

export default defineNitroPlugin((nitro) => {
  const clean = () => maintainCache(true).catch(() => console.warn('[cache] 缓存维护失败，将在下个周期重试'))
  const timer = setInterval(() => { void clean() }, 60_000)
  timer.unref?.()
  void clean()
  nitro.hooks.hook('close', () => { clearInterval(timer) })
})

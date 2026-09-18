import { maintainCache } from '../services/cache'
import { maintainAttachments } from '../services/attachments'

export default defineNitroPlugin((nitro) => {
  const clean = async () => {
    try { maintainAttachments(); await maintainCache(true) }
    catch { console.warn('[cache] 缓存或未发送附件维护失败，将在下个周期重试') }
  }
  const timer = setInterval(() => { void clean() }, 60_000)
  timer.unref?.()
  void clean()
  nitro.hooks.hook('close', () => { clearInterval(timer) })
})

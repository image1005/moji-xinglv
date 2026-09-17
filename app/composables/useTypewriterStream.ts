/**
 * 自适应平滑打字机流式引擎（Adaptive Typewriter Streamer）
 * 解决大模型极速生成时的批量跳帧闪现体验问题，提供 60fps 的自然水墨行文效果。
 */

export interface TypewriterOptions {
  tickMs?: number
  onTick?: () => void
}

export interface TypewriterInstance {
  bind: (target: Record<string, unknown>, key: string) => void
  push: (text: string) => void
  finish: () => Promise<void>
  flushInstant: () => void
  reset: () => void
}

function computeStep(bufferLength: number): number {
  if (bufferLength < 8) return 1
  if (bufferLength < 24) return 2
  if (bufferLength < 60) return 4
  if (bufferLength < 160) return 8
  return 16
}

export function useTypewriterStream(options: TypewriterOptions = {}): TypewriterInstance {
  const tickMs = options.tickMs || 16

  let buffer = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  let activeTarget: Record<string, unknown> | null = null
  let activeKey = 'content'
  let pendingResolvers: Array<() => void> = []

  const resolveAll = () => {
    const resolvers = pendingResolvers
    pendingResolvers = []
    resolvers.forEach((r) => r())
  }

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const schedule = () => {
    if (timer !== null) return
    timer = setTimeout(tick, tickMs)
  }

  const tick = () => {
    timer = null

    if (!activeTarget) return

    if (buffer.length === 0) {
      resolveAll()
      return
    }

    const step = computeStep(buffer.length)
    activeTarget[activeKey] = String(activeTarget[activeKey] || '') + buffer.slice(0, step)
    buffer = buffer.slice(step)

    if (options.onTick) {
      try {
        options.onTick()
      } catch {
        // ignore scroll error
      }
    }

    if (buffer.length > 0) {
      schedule()
    } else {
      resolveAll()
    }
  }

  return {
    bind(target: Record<string, unknown>, key: string) {
      activeTarget = target
      activeKey = key
    },
    push(text: string) {
      if (!text) return
      buffer += text
      if (activeTarget) {
        schedule()
      }
    },
    finish(): Promise<void> {
      if (!activeTarget) {
        buffer = ''
        return Promise.resolve()
      }
      if (buffer.length === 0 && timer === null) {
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        pendingResolvers.push(resolve)
        schedule()
      })
    },
    flushInstant() {
      if (activeTarget && buffer.length > 0) {
        activeTarget[activeKey] = String(activeTarget[activeKey] || '') + buffer
        buffer = ''
      }
      clearTimer()
      resolveAll()
    },
    reset() {
      buffer = ''
      clearTimer()
      pendingResolvers = []
      activeTarget = null
    },
  }
}

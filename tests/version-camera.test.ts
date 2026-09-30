import { describe, expect, it } from 'vitest'
import { cameraScale, fitVersionCamera, moveVersionCamera, transformCanvasPoint } from '../app/utils/version-camera'

describe('版本画布镜头坐标', () => {
  it.each([
    [{ width: 184, height: 9000 }, { width: 1300, height: 520 }],
    [{ width: 9000, height: 184 }, { width: 360, height: 520 }],
  ])('长树和宽分叉完整适应不同宽高比的视口', (content, viewport) => {
    const camera = fitVersionCamera(content, viewport)
    expect(camera.width / camera.height).toBeCloseTo(viewport.width / viewport.height)
    expect(camera.x).toBeLessThanOrEqual(0)
    expect(camera.y).toBeLessThanOrEqual(0)
    expect(camera.x + camera.width).toBeGreaterThanOrEqual(content.width + 56)
    expect(camera.y + camera.height).toBeGreaterThanOrEqual(content.height + 56)
  })

  it('meet 留白下逆矩阵对两个方向使用真实统一比例', () => {
    // 120×794 viewBox in a 1338×520 canvas: x has ~630px gutters.
    const scale = 520 / 794
    const offsetX = (1338 - 120 * scale) / 2
    const inverse = { a: 1 / scale, b: 0, c: 0, d: 1 / scale, e: -offsetX / scale, f: 0 }
    const start = transformCanvasPoint(inverse, { x: 200, y: 100 })
    const end = transformCanvasPoint(inverse, { x: 300, y: 160 })
    const camera = { x: 0, y: 0, width: 120, height: 794 }
    const moved = moveVersionCamera(camera, start, end)
    expect(-moved.x * scale).toBeCloseTo(100)
    expect(-moved.y * scale).toBeCloseTo(60)
  })

  it('缩放保持鼠标下的世界坐标与屏幕位置', () => {
    const camera = { x: -450, y: 120, width: 1500, height: 600 }
    const anchor = { x: -200, y: 550 }
    const next = moveVersionCamera(camera, anchor, anchor, 0.4)
    expect((anchor.x - camera.x) / camera.width).toBeCloseTo((anchor.x - next.x) / next.width)
    expect((anchor.y - camera.y) / camera.height).toBeCloseTo((anchor.y - next.y) / next.height)
  })

  it('双指中点移动与缩放可同时进行且锚点跟手', () => {
    const camera = { x: -200, y: 50, width: 800, height: 400 }
    const anchor = { x: 150, y: 100 }
    const midpoint = { x: 230, y: 140 }
    const next = moveVersionCamera(camera, anchor, midpoint, 0.5)
    expect((anchor.x - next.x) / next.width).toBeCloseTo((midpoint.x - camera.x) / camera.width)
    expect((anchor.y - next.y) / next.height).toBeCloseTo((midpoint.y - camera.y) / camera.height)
    expect(cameraScale(next, { width: 800, height: 400 })).toBe(2)
  })
})

export interface CanvasPoint { x: number; y: number }
export interface CanvasCamera extends CanvasPoint { width: number; height: number }
export interface CanvasSize { width: number; height: number }

/** Fit with a uniform scale, including the gutters created by SVG's `meet`. */
export function fitVersionCamera(content: CanvasSize, viewport: CanvasSize, padding = 28): CanvasCamera {
  const width = Math.max(1, content.width) + padding * 2
  const height = Math.max(1, content.height) + padding * 2
  const scale = Math.min(viewport.width / width, viewport.height / height, 1)
  const cameraWidth = viewport.width / scale
  const cameraHeight = viewport.height / scale
  return { x: (width - cameraWidth) / 2, y: (height - cameraHeight) / 2, width: cameraWidth, height: cameraHeight }
}

export function cameraScale(camera: CanvasCamera, viewport: CanvasSize): number {
  return Math.min(viewport.width / camera.width, viewport.height / camera.height)
}

/** Keep the initial anchor under a moving pointer/midpoint, for pan and pinch alike. */
export function moveVersionCamera(camera: CanvasCamera, anchor: CanvasPoint, pointer: CanvasPoint, ratio = 1): CanvasCamera {
  return {
    x: anchor.x + (camera.x - pointer.x) * ratio,
    y: anchor.y + (camera.y - pointer.y) * ratio,
    width: camera.width * ratio,
    height: camera.height * ratio,
  }
}

/** A captured inverse CTM is stable throughout one gesture, even before Vue paints. */
export function transformCanvasPoint(matrix: Pick<DOMMatrix, 'a' | 'b' | 'c' | 'd' | 'e' | 'f'>, point: CanvasPoint): CanvasPoint {
  return { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f }
}

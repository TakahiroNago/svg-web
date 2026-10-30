// Zoom and pan math shared by the viewer and the toolbar.

export type View = { scale: number; x: number; y: number }
export const INITIAL_VIEW: View = { scale: 1, x: 0, y: 0 }
export const MIN_SCALE = 1
export const MAX_SCALE = 64
export const ZOOM_STEP = 1.25

// Keeps the scaled image covering the frame, so it cannot be dragged out of sight.
export function clampView(v: View, w: number, h: number): View {
  if (v.scale <= MIN_SCALE) return INITIAL_VIEW
  return {
    scale: v.scale,
    x: Math.min(0, Math.max(w - w * v.scale, v.x)),
    y: Math.min(0, Math.max(h - h * v.scale, v.y)),
  }
}

// Zooms by `factor` while keeping the frame point (cx, cy) in place.
export function zoomAt(v: View, factor: number, cx: number, cy: number, w: number, h: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
  const k = scale / v.scale
  return clampView({ scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }, w, h)
}

// Zooms around the center of `frame`; used by the toolbar buttons outside the viewer.
export function zoomFrameCenter(
  frame: HTMLElement | null,
  setView: React.Dispatch<React.SetStateAction<View>>,
  factor: number,
) {
  if (!frame) return
  const w = frame.clientWidth
  const h = frame.clientHeight
  setView((v) => zoomAt(v, factor, w / 2, h / 2, w, h))
}

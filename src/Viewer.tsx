import { useCallback, useEffect, useRef } from 'react'
import { clampView, INITIAL_VIEW, MIN_SCALE, ZOOM_STEP, zoomAt, type View } from './view.ts'

const PAN_STEP = 40
const SPLIT_STEP = 5

type Point = { x: number; y: number }

function pinchOf(a: Point, b: Point) {
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
}

// Shows the SVG, optionally with the original layered on its left side up to `split` percent.
// Both layers share one transform, so zooming and panning keep them aligned.
export function Viewer({
  frameRef,
  original,
  svg,
  compare,
  view,
  setView,
  split,
  setSplit,
  busyLabel,
}: {
  frameRef: React.RefObject<HTMLDivElement | null>
  original: string
  svg: string | null
  compare: boolean
  view: View
  setView: React.Dispatch<React.SetStateAction<View>>
  split: number
  setSplit: (n: number) => void
  busyLabel: string | null
}) {
  const pointers = useRef(new Map<number, Point>())

  // Applies `f` with the frame size; does nothing before the frame is mounted.
  const update = useCallback(
    (f: (v: View, w: number, h: number) => View) => {
      const el = frameRef.current
      if (!el) return
      const w = el.clientWidth
      const h = el.clientHeight
      setView((v) => f(v, w, h))
    },
    [frameRef, setView],
  )
  const pan = (dx: number, dy: number) => update((v, w, h) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, w, h))

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // A plain wheel scrolls the page. Ctrl/⌘ + wheel zooms; trackpad pinches arrive as that too.
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * 0.002)
      update((v, w, h) => zoomAt(v, factor, e.clientX - rect.left, e.clientY - rect.top, w, h))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [frameRef, update])

  const setSplitFromX = (clientX: number) => {
    const el = frameRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setSplit(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)))
  }

  const endPointer = (e: React.PointerEvent) => pointers.current.delete(e.pointerId)
  const zoomed = view.scale > MIN_SCALE
  const layered = compare && !!svg
  const transform = { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }

  return (
    <div
      ref={frameRef}
      className={`viewer${zoomed ? ' zoomed' : ''}`}
      tabIndex={0}
      role="group"
      aria-label="プレビュー（+ / - で拡大縮小、矢印キーで移動、0 でリセット）"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      }}
      onPointerMove={(e) => {
        const ps = pointers.current
        const prev = ps.get(e.pointerId)
        if (!prev) return
        const cur = { x: e.clientX, y: e.clientY }
        ps.set(e.pointerId, cur)
        if (ps.size === 1) {
          pan(cur.x - prev.x, cur.y - prev.y)
        } else if (ps.size === 2) {
          const other = [...ps].find(([id]) => id !== e.pointerId)![1]
          const before = pinchOf(prev, other)
          const after = pinchOf(cur, other)
          if (before.dist === 0) return
          const rect = e.currentTarget.getBoundingClientRect()
          update((v, w, h) => {
            const z = zoomAt(v, after.dist / before.dist, after.cx - rect.left, after.cy - rect.top, w, h)
            return clampView({ ...z, x: z.x + after.cx - before.cx, y: z.y + after.cy - before.cy }, w, h)
          })
        }
      }}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onDoubleClick={() => setView(INITIAL_VIEW)}
      onKeyDown={(e) => {
        const arrows: Record<string, [number, number]> = {
          ArrowLeft: [PAN_STEP, 0],
          ArrowRight: [-PAN_STEP, 0],
          ArrowUp: [0, PAN_STEP],
          ArrowDown: [0, -PAN_STEP],
        }
        if (e.key === '+' || e.key === '=') update((v, w, h) => zoomAt(v, ZOOM_STEP, w / 2, h / 2, w, h))
        else if (e.key === '-') update((v, w, h) => zoomAt(v, 1 / ZOOM_STEP, w / 2, h / 2, w, h))
        else if (e.key === '0') setView(INITIAL_VIEW)
        // At 1x there is nothing to pan, so let the arrows scroll the page.
        else if (e.key in arrows && zoomed) pan(...arrows[e.key])
        else return
        e.preventDefault()
      }}
    >
      <div className="layer" style={transform}>
        <img src={svg ?? original} alt={svg ? '変換後の SVG' : '元画像'} draggable={false} />
      </div>
      {layered && (
        <>
          <div className="layer-clip" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
            <div className="layer" style={transform}>
              <img src={original} alt="元画像" draggable={false} />
            </div>
          </div>
          <div className="divider" style={{ left: `${split}%` }}>
            <div
              className="knob"
              role="slider"
              tabIndex={0}
              aria-label="比較の境界"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(split)}
              aria-valuetext={`元画像 ${Math.round(split)}%`}
              onPointerDown={(e) => {
                // The knob moves the divider; everywhere else a drag pans the image.
                e.stopPropagation()
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) setSplitFromX(e.clientX)
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                const next =
                  e.key === 'ArrowLeft' ? split - SPLIT_STEP
                  : e.key === 'ArrowRight' ? split + SPLIT_STEP
                  : e.key === 'Home' ? 0
                  : e.key === 'End' ? 100
                  : null
                e.stopPropagation()
                if (next === null) return
                e.preventDefault()
                setSplit(Math.min(100, Math.max(0, next)))
              }}
            >
              ⇆
            </div>
          </div>
          <span className="tag tag-left">元画像</span>
        </>
      )}
      {svg && <span className="tag tag-right">SVG</span>}
      <span className="tag tag-hint hint-touch">ピンチで拡大</span>
      <span className="tag tag-hint hint-mouse">Ctrl + ホイールで拡大・ダブルクリックで戻す</span>
      {busyLabel && (
        <div className="viewer-busy" role="status">
          <span className="spinner" aria-hidden="true" />
          {busyLabel}
        </div>
      )}
    </div>
  )
}

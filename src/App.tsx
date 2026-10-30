import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { decodeImage } from './converter/decode.ts'
import { COLOR_OPTIONS, DEFAULT_COLORS, MAX_FILE_BYTES, validateFile } from './converter/limits.ts'
import { useConverter } from './converter/useConverter.ts'
import type { PaletteColor } from './wasm/svg-converter.js'

type Status = 'idle' | 'decoding' | 'converting' | 'done' | 'error'

// Settings the shown SVG was generated with, so changes can be detected and the download named correctly.
type Result = { blob: Blob; contours: number; colors: number; boundary: boolean; kept: string }

type View = { scale: number; x: number; y: number }
const INITIAL_VIEW: View = { scale: 1, x: 0, y: 0 }
const MIN_SCALE = 1
const MAX_SCALE = 64
const ZOOM_STEP = 1.25
const PAN_STEP = 40

// Keeps the scaled image covering the frame, so it cannot be dragged out of sight.
function clampView(v: View, w: number, h: number): View {
  if (v.scale <= MIN_SCALE) return INITIAL_VIEW
  return {
    scale: v.scale,
    x: Math.min(0, Math.max(w - w * v.scale, v.x)),
    y: Math.min(0, Math.max(h - h * v.scale, v.y)),
  }
}

// Zooms by `factor` while keeping the frame point (cx, cy) in place.
function zoomAt(v: View, factor: number, cx: number, cy: number, w: number, h: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
  const k = scale / v.scale
  return clampView({ scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }, w, h)
}

type Point = { x: number; y: number }

function pinchOf(a: Point, b: Point) {
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
}

// Both frames have the same size, so a shared pixel-based view keeps them in sync.
function ZoomFrame({
  src,
  alt,
  view,
  setView,
}: {
  src: string
  alt: string
  view: View
  setView: React.Dispatch<React.SetStateAction<View>>
}) {
  const frameRef = useRef<HTMLDivElement>(null)
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
    [setView],
  )
  const zoomCenter = (factor: number) => update((v, w, h) => zoomAt(v, factor, w / 2, h / 2, w, h))
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
  }, [update])

  const endPointer = (e: React.PointerEvent) => pointers.current.delete(e.pointerId)
  const zoomed = view.scale > MIN_SCALE

  return (
    <>
      <div
        ref={frameRef}
        className={`frame zoom-frame${zoomed ? ' zoomed' : ''}`}
        tabIndex={0}
        role="group"
        aria-label={`${alt}（+ / - で拡大縮小、矢印キーで移動、0 でリセット）`}
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
          if (e.key === '+' || e.key === '=') zoomCenter(ZOOM_STEP)
          else if (e.key === '-') zoomCenter(1 / ZOOM_STEP)
          else if (e.key === '0') setView(INITIAL_VIEW)
          // At 1x there is nothing to pan, so let the arrows scroll the page.
          else if (e.key in arrows && zoomed) pan(...arrows[e.key])
          else return
          e.preventDefault()
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>
      <div className="zoom-bar">
        <button
          type="button"
          className="secondary"
          aria-label="縮小"
          disabled={!zoomed}
          onClick={() => zoomCenter(1 / ZOOM_STEP)}
        >
          −
        </button>
        <span className="zoom-level">{Math.round(view.scale * 100)}%</span>
        <button
          type="button"
          className="secondary"
          aria-label="拡大"
          disabled={view.scale >= MAX_SCALE}
          onClick={() => zoomCenter(ZOOM_STEP)}
        >
          +
        </button>
        <button type="button" className="secondary" disabled={!zoomed} onClick={() => setView(INITIAL_VIEW)}>
          リセット
        </button>
      </div>
    </>
  )
}

function CompareView({ before, after }: { before: string; after: string }) {
  const [split, setSplit] = useState(50)
  const setFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setSplit(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)))
  }

  return (
    <>
      <div
        className="compare"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setFromPointer(e)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromPointer(e)
        }}
      >
        <img className="base" src={after} alt="変換後" draggable={false} />
        <img
          className="over"
          src={before}
          alt="変換前"
          draggable={false}
          style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
        />
        <div className="handle" style={{ left: `${split}%` }} />
        <span className="tag left">変換前</span>
        <span className="tag right">変換後</span>
      </div>
      <label className="slider">
        <span>画像上をドラッグするか、スライダーで境界を動かせます</span>
        <input
          type="range"
          min={0}
          max={100}
          step="any"
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          aria-label="比較スライダー"
        />
      </label>
    </>
  )
}

function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) return
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => {
      URL.revokeObjectURL(u)
      setUrl(null)
    }
  }, [blob])
  return blob ? url : null
}

function useImageSize(url: string | null): { width: number; height: number } | null {
  const [size, setSize] = useState<{ url: string; width: number; height: number } | null>(null)
  useEffect(() => {
    if (!url) return
    const img = new Image()
    img.onload = () => setSize({ url, width: img.naturalWidth, height: img.naturalHeight })
    img.src = url
    return () => {
      img.onload = null
    }
  }, [url])
  return size && size.url === url ? size : null
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatShare(area: number, total: number): string {
  const pct = total > 0 ? (area / total) * 100 : 0
  return pct < 0.1 ? '<0.1%' : `${pct.toFixed(1)}%`
}

export default function App() {
  const { mode, engine, engineError, convert, generate } = useConverter()
  const [file, setFile] = useState<File | null>(null)
  const [colors, setColors] = useState<number>(DEFAULT_COLORS)
  const [boundary, setBoundary] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [layout, setLayout] = useState<'side' | 'compare'>('side')
  const [dragging, setDragging] = useState(false)
  const [view, setView] = useState<View>(INITIAL_VIEW)
  const [palette, setPalette] = useState<PaletteColor[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const runId = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const originalUrl = useObjectUrl(file)
  const originalSize = useImageSize(originalUrl)
  // The SVG is shown through <img>, so scripts inside it never run and it never enters the DOM.
  const svgUrl = useObjectUrl(result?.blob ?? null)

  const onFile = useCallback((f: File | undefined) => {
    runId.current++
    setResult(null)
    setView(INITIAL_VIEW)
    setPalette([])
    setSelected(new Set())
    setStatus('idle')
    if (!f) {
      setFile(null)
      return
    }
    const err = validateFile(f)
    if (err) {
      setFile(null)
      setError(err)
      setStatus('error')
      return
    }
    setError('')
    setFile(f)
  }, [])

  // Files can be dropped anywhere on the page. Without this, a drop outside a drop zone
  // would make the browser open the image and discard the current work.
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      onFile(e.dataTransfer!.files[0])
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [onFile])

  const keptKey = (indices: number[]) => indices.join(',')
  const selectedKey = keptKey(palette.filter((c) => selected.has(c.index)).map((c) => c.index))

  const run = useCallback(async () => {
    if (!file) return
    const id = ++runId.current
    setError('')
    setStatus('decoding')
    try {
      const img = await decodeImage(file)
      if (id !== runId.current) return
      setStatus('converting')
      const out = await convert(img.rgba, img.width, img.height, colors, boundary)
      if (id !== runId.current) return
      const all = out.palette.filter((c) => c.area > 0)
      setPalette(all)
      setSelected(new Set(all.map((c) => c.index)))
      setResult({
        blob: new Blob([out.svg], { type: 'image/svg+xml' }),
        contours: out.contourCount,
        colors,
        boundary,
        kept: keptKey(all.map((c) => c.index)),
      })
      setStatus('done')
    } catch (e) {
      if (id !== runId.current) return
      setResult(null)
      setPalette([])
      setError((e as Error).message)
      setStatus('error')
    }
  }, [file, colors, boundary, convert])

  const regenerate = useCallback(async () => {
    if (!result) return
    const id = ++runId.current
    setError('')
    setStatus('converting')
    try {
      const kept = palette.filter((c) => selected.has(c.index)).map((c) => c.index)
      const out = await generate(kept, boundary)
      if (id !== runId.current) return
      setResult({
        blob: new Blob([out.svg], { type: 'image/svg+xml' }),
        contours: out.contourCount,
        colors: result.colors,
        boundary,
        kept: keptKey(kept),
      })
      setStatus('done')
    } catch (e) {
      if (id !== runId.current) return
      setError((e as Error).message)
      setStatus('error')
    }
  }, [result, palette, selected, boundary, generate])

  const toggleColor = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  const busy = status === 'decoding' || status === 'converting'
  const canRun = !!file && engine === 'ready' && !busy
  // A different color count needs a new analysis; other changes only need the SVG regenerated.
  const needsAnalyze = !!result && colors !== result.colors
  const needsRegenerate =
    !!result && !needsAnalyze && (boundary !== result.boundary || selectedKey !== result.kept)
  const canRegenerate = canRun && !!result && !needsAnalyze && selected.size > 0
  const totalArea = palette.reduce((sum, c) => sum + c.area, 0)

  const download = () => {
    if (!svgUrl || !file || !result) return
    const a = document.createElement('a')
    a.href = svgUrl
    a.download = file.name.replace(/\.[^.]+$/, '') + (result.boundary ? '-boundary' : '') + '.svg'
    a.click()
  }

  return (
    <main className="app">
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          ここにドロップして画像を読み込みます
        </div>
      )}

      <header>
        <h1>画像 → SVG 変換</h1>
        {mode === 'server' ? (
          <>
            <p className="badge notice" data-testid="privacy-notice">
              画像は変換のためサーバーへ送信されます。機密性の高い画像や個人情報を含む画像はアップロードしないでください。
            </p>
            {/* Nothing is requested until a conversion runs, so this must not read as a health check. */}
            <p className="mode-note" role="status">
              サーバー(Go REST API → gRPC → C++ / OpenCV)で変換します。変換サーバーの状態は、変換を実行したときに確認されます。
            </p>
          </>
        ) : (
          <div className="mode-row">
            <p className="mode-note" data-testid="privacy-notice">
              ブラウザ内で WebAssembly を使って変換します。画像は外部に送信されません。
            </p>
            <p className={`pill engine-${engine}`} role="status">
              {engine === 'initializing' && '変換エンジンを初期化中…'}
              {engine === 'ready' && '変換エンジン準備完了'}
              {engine === 'failed' && `エンジンの初期化に失敗しました: ${engineError}`}
            </p>
          </div>
        )}
      </header>

      <section className="panel controls">
        <div className="field">
          <span>画像ファイル (PNG / JPEG、{MAX_FILE_BYTES / 1024 / 1024} MB まで)</span>
          <div className="file-picker">
            <label className="file-button">
              画像を選択
              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => {
                  onFile(e.target.files?.[0])
                  // The chosen file is shown next to the button, and clearing lets the same file be picked again.
                  e.target.value = ''
                }}
              />
            </label>
            <span className="file-name">{file ? `${file.name}（${formatBytes(file.size)}）` : '未選択'}</span>
          </div>
        </div>
        <label className="field">
          <span>色数</span>
          <select value={colors} onChange={(e) => setColors(Number(e.target.value))}>
            {COLOR_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c} 色
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={boundary} onChange={(e) => setBoundary(e.target.checked)} />
          <span>境界線モード(塗りなし)</span>
        </label>
        <button type="button" onClick={run} disabled={!canRun}>
          {busy ? '変換中…' : '変換する'}
        </button>
      </section>

      {busy && (
        <p className="badge busy" role="status">
          {status === 'decoding'
            ? '画像をデコード中…'
            : mode === 'server'
              ? 'サーバーで SVG に変換中…(画像が大きいと時間がかかります)'
              : 'SVG に変換中…(画像が大きいと時間がかかります)'}
        </p>
      )}
      {status === 'error' && (
        <p className="badge error" role="alert">
          エラー: {error}
        </p>
      )}
      {!busy && needsAnalyze && (
        <p className="badge warn" role="status">
          色数が変更されました。「変換する」を押すと画像を解析し直します。
        </p>
      )}
      {!busy && needsRegenerate && (
        <p className="badge warn" role="status">
          設定が変更されました。「再変換」を押すとプレビューに反映されます。
        </p>
      )}

      {palette.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>使用する色</h2>
            <button
              type="button"
              className="secondary"
              disabled={selected.size === palette.length}
              onClick={() => setSelected(new Set(palette.map((c) => c.index)))}
            >
              すべて選択
            </button>
            <button
              type="button"
              className="secondary"
              disabled={selected.size === 0}
              onClick={() => setSelected(new Set())}
            >
              すべて解除
            </button>
          </div>
          <ul className="palette">
            {palette.map((c) => {
              const share = formatShare(c.area, totalArea)
              return (
                <li key={c.index}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={selected.has(c.index)}
                      onChange={() => toggleColor(c.index)}
                      aria-label={`${c.hex}（${share}）`}
                    />
                    <span className="swatch" style={{ background: c.hex }} title={c.hex} />
                    <span className="share">{share}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          <button type="button" onClick={regenerate} disabled={!canRegenerate}>
            再変換
          </button>
          {selected.size === 0 && <p className="hint">少なくとも 1 色を選択してください。</p>}
        </section>
      )}

      {result && svgUrl && (
        <div className="result-bar">
          <div className="segmented" role="group" aria-label="表示方法">
            <button
              type="button"
              aria-pressed={layout === 'side'}
              onClick={() => setLayout('side')}
            >
              並べて表示
            </button>
            <button
              type="button"
              aria-pressed={layout === 'compare'}
              onClick={() => setLayout('compare')}
            >
              重ねて比較
            </button>
          </div>
          <button type="button" onClick={download}>
            SVG をダウンロード
          </button>
        </div>
      )}

      {originalUrl && svgUrl && layout === 'compare' ? (
        <section className="panel">
          <h2>変換前後の比較</h2>
          <CompareView before={originalUrl} after={svgUrl} />
        </section>
      ) : (
        <>
          <div className="grid">
            <section className="panel">
              <h2>
                元画像
                {originalSize && (
                  <small>
                    {' '}
                    {originalSize.width}×{originalSize.height} px
                  </small>
                )}
              </h2>
              {originalUrl ? (
                <ZoomFrame src={originalUrl} alt="選択した元画像" view={view} setView={setView} />
              ) : (
                <button type="button" className="dropzone" onClick={() => fileInput.current?.click()}>
                  クリックして画像を選択、またはページにドラッグ&ドロップしてください
                </button>
              )}
            </section>

            <section className="panel">
              <h2>
                SVG プレビュー
                {result && (
                  <small>
                    {' '}
                    輪郭 {result.contours.toLocaleString()} 件 · {formatBytes(result.blob.size)}
                  </small>
                )}
              </h2>
              {svgUrl ? (
                <ZoomFrame src={svgUrl} alt="変換後の SVG" view={view} setView={setView} />
              ) : (
                <p className="placeholder">変換結果がここに表示されます</p>
              )}
            </section>
          </div>
          {originalUrl && (
            <p className="hint">
              Ctrl(⌘) + ホイールまたはピンチで拡大、ドラッグで移動、ダブルクリックで元に戻します。2 つの表示は連動します。
            </p>
          )}
        </>
      )}
    </main>
  )
}

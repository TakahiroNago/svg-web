import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { decodeImage } from './converter/decode.ts'
import { COLOR_OPTIONS, DEFAULT_COLORS, validateFile } from './converter/limits.ts'
import { useConverter } from './converter/useConverter.ts'
import type { PaletteColor } from './wasm/svg-converter.js'

type Status = 'idle' | 'decoding' | 'converting' | 'done' | 'error'

type View = { scale: number; x: number; y: number }
const INITIAL_VIEW: View = { scale: 1, x: 0, y: 0 }
const MIN_SCALE = 1
const MAX_SCALE = 64

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
  const drag = useRef<{ px: number; py: number } | null>(null)

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      setView((v) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * Math.exp(-e.deltaY * 0.002)))
        if (scale === MIN_SCALE) return INITIAL_VIEW
        const k = scale / v.scale
        return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setView])

  return (
    <div
      ref={frameRef}
      className="frame zoom-frame"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { px: e.clientX, py: e.clientY }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.px
        const dy = e.clientY - d.py
        drag.current = { px: e.clientX, py: e.clientY }
        setView((v) => (v.scale === MIN_SCALE ? v : { ...v, x: v.x + dx, y: v.y + dy }))
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => setView(INITIAL_VIEW)}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      />
    </div>
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

export default function App() {
  const { mode, engine, engineError, convert, generate } = useConverter()
  const [file, setFile] = useState<File | null>(null)
  const [colors, setColors] = useState<number>(DEFAULT_COLORS)
  const [boundary, setBoundary] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [svgBlob, setSvgBlob] = useState<Blob | null>(null)
  const [contours, setContours] = useState(0)
  const [split, setSplit] = useState(50)
  const [stale, setStale] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [view, setView] = useState<View>(INITIAL_VIEW)
  const [palette, setPalette] = useState<PaletteColor[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [analyzedColors, setAnalyzedColors] = useState(0)
  const runId = useRef(0)
  const markStale = () => svgBlob && setStale(true)

  const originalUrl = useObjectUrl(file)
  // The SVG is shown through <img>, so scripts inside it never run and it never enters the DOM.
  const svgUrl = useObjectUrl(svgBlob)

  const onFile = (f: File | undefined) => {
    runId.current++
    setSvgBlob(null)
    setView(INITIAL_VIEW)
    setPalette([])
    setSelected(new Set())
    setStale(false)
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
  }

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
      setAnalyzedColors(colors)
      setSvgBlob(new Blob([out.svg], { type: 'image/svg+xml' }))
      setContours(out.contourCount)
      setStale(false)
      setStatus('done')
    } catch (e) {
      if (id !== runId.current) return
      setSvgBlob(null)
      setPalette([])
      setError((e as Error).message)
      setStatus('error')
    }
  }, [file, colors, boundary, convert])

  const regenerate = useCallback(async () => {
    const id = ++runId.current
    setError('')
    setStatus('converting')
    try {
      const kept = palette.filter((c) => selected.has(c.index)).map((c) => c.index)
      const out = await generate(kept, boundary)
      if (id !== runId.current) return
      setSvgBlob(new Blob([out.svg], { type: 'image/svg+xml' }))
      setContours(out.contourCount)
      setStale(false)
      setStatus('done')
    } catch (e) {
      if (id !== runId.current) return
      setError((e as Error).message)
      setStatus('error')
    }
  }, [palette, selected, boundary, generate])

  const toggleColor = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(index)) next.add(index)
      return next
    })
    markStale()
  }

  const busy = status === 'decoding' || status === 'converting'
  const canRun = !!file && engine === 'ready' && !busy
  const canRegenerate =
    canRun && palette.length > 0 && selected.size > 0 && analyzedColors === colors

  const download = () => {
    if (!svgUrl || !file) return
    const a = document.createElement('a')
    a.href = svgUrl
    a.download = file.name.replace(/\.[^.]+$/, '') + (boundary ? '-boundary' : '') + '.svg'
    a.click()
  }

  return (
    <main className="app">
      <header>
        <h1>画像 → SVG 変換</h1>
        {mode === 'server' ? (
          <>
            <p>サーバー(Go REST API → gRPC → C++ / OpenCV)で変換します。</p>
            <p className="badge notice" data-testid="privacy-notice">
              画像は変換のためサーバーへ送信されます。機密性の高い画像や個人情報を含む画像はアップロードしないでください。
            </p>
            {/* Nothing is requested until a conversion runs, so this must not read as a health check. */}
            <p className="badge engine-server" role="status">
              サーバー変換モード: 変換サーバーの状態は、変換を実行したときに確認されます。
            </p>
          </>
        ) : (
          <>
            <p data-testid="privacy-notice">
              ブラウザ内で WebAssembly を使って変換します。画像は外部に送信されません。
            </p>
            <p className={`badge engine-${engine}`} role="status">
              {engine === 'initializing' && '変換エンジンを初期化中…'}
              {engine === 'ready' && '変換エンジン準備完了'}
              {engine === 'failed' && `エンジンの初期化に失敗しました: ${engineError}`}
            </p>
          </>
        )}
      </header>

      <section className="panel controls">
        <label className="field">
          <span>画像ファイル (PNG / JPEG)</span>
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        <label className="field">
          <span>色数</span>
          <select
            value={colors}
            onChange={(e) => {
              setColors(Number(e.target.value))
              markStale()
            }}
          >
            {COLOR_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c} 色
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={boundary}
            onChange={(e) => {
              setBoundary(e.target.checked)
              markStale()
            }}
          />
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
      {stale && <p className="badge warn">設定が変更されました。「再変換」(色数変更時は「変換する」)を押してください。</p>}

      {palette.length > 0 && (
        <section className="panel">
          <h2>使用する色</h2>
          <ul className="palette">
            {palette.map((c) => (
              <li key={c.index}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selected.has(c.index)}
                    onChange={() => toggleColor(c.index)}
                  />
                  <span className="swatch" style={{ background: c.hex }} title={c.hex} />
                </label>
              </li>
            ))}
          </ul>
          <button type="button" onClick={regenerate} disabled={!canRegenerate}>
            再変換
          </button>
          {analyzedColors !== colors && (
            <p className="badge warn">色数を変更した場合は「変換する」で再解析してください。</p>
          )}
        </section>
      )}

      <div className="grid">
        <section
          className={`panel${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            onFile(e.dataTransfer.files[0])
          }}
        >
          <h2>元画像</h2>
          {originalUrl ? (
            <ZoomFrame src={originalUrl} alt="選択した元画像" view={view} setView={setView} />
          ) : (
            <p className="placeholder">画像を選択、またはここにドラッグ&ドロップしてください</p>
          )}
        </section>

        <section className="panel">
          <h2>
            SVG プレビュー
            {status === 'done' && <small> 輪郭 {contours.toLocaleString()} 件</small>}
          </h2>
          {svgUrl ? (
            <>
              <ZoomFrame src={svgUrl} alt="変換後の SVG" view={view} setView={setView} />
              <button type="button" onClick={download}>
                SVG をダウンロード
              </button>
            </>
          ) : (
            <p className="placeholder">変換結果がここに表示されます</p>
          )}
        </section>
      </div>

      {originalUrl && svgUrl && (
        <section className="panel">
          <h2>変換前後の比較</h2>
          <div className="compare">
            <img className="base" src={svgUrl} alt="変換後" />
            <img
              className="over"
              src={originalUrl}
              alt="変換前"
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
            />
            <div className="handle" style={{ left: `${split}%` }} />
          </div>
          <label className="slider">
            <span>左: 変換前 / 右: 変換後</span>
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
              aria-label="比較スライダー"
            />
          </label>
        </section>
      )}
    </main>
  )
}

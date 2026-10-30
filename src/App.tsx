import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { decodeImage } from './converter/decode.ts'
import { COLOR_OPTIONS, DEFAULT_COLORS, MAX_FILE_BYTES, validateFile } from './converter/limits.ts'
import { useConverter } from './converter/useConverter.ts'
import { HelpDialog, type HelpTopic } from './HelpDialog.tsx'
import { createSampleImage } from './sample.ts'
import { INITIAL_VIEW, MAX_SCALE, MIN_SCALE, ZOOM_STEP, zoomFrameCenter, type View } from './view.ts'
import { Viewer } from './Viewer.tsx'
import type { PaletteColor } from './wasm/svg-converter.js'

type Status = 'idle' | 'decoding' | 'converting'

type ViewMode = 'compare' | 'svg' | 'code'

// The SVG on screen and the settings it was generated with. Comparing these with the current
// settings decides whether to re-analyze, regenerate, or do nothing.
type Result = {
  file: File
  svg: string
  blob: Blob
  paths: number
  colors: number
  boundary: boolean
  kept: string
}

// Settings changes wait this long, so dragging the slider sends one conversion, not dozens.
const SETTLE_MS = 400
// Rendering a multi-megabyte SVG as text would freeze the page; copying still gives the whole file.
const CODE_PREVIEW_CHARS = 200_000

const PRESETS = [
  { label: 'ロゴ', sub: '2–8色', colors: 6 },
  { label: 'イラスト', sub: '8–16色', colors: 12 },
  { label: '写真', sub: '16色〜', colors: 24 },
] as const

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

const keptKey = (indices: number[]) => indices.join(',')

// The engine writes one <path> per color (holes included), so this differs from its contour count.
const countPaths = (svg: string) => svg.match(/<path\b/g)?.length ?? 0

export default function App() {
  const { mode, engine, engineError, convert, generate } = useConverter()
  const [file, setFile] = useState<File | null>(null)
  const [colors, setColors] = useState<number>(DEFAULT_COLORS)
  const [boundary, setBoundary] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [palette, setPalette] = useState<PaletteColor[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [viewMode, setViewMode] = useState<ViewMode>('compare')
  const [view, setView] = useState<View>(INITIAL_VIEW)
  const [split, setSplit] = useState(50)
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState(false)
  const [help, setHelp] = useState<HelpTopic | null>(null)
  const runId = useRef(0)
  // The attempt that last failed, so a broken image or a down server is not retried in a loop.
  const failed = useRef<{ file: File; key: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)

  const originalUrl = useObjectUrl(file)
  const originalSize = useImageSize(originalUrl)
  // The SVG is shown through <img>, so scripts inside it never run and it never enters the DOM.
  const svgUrl = useObjectUrl(result?.blob ?? null)

  const onFile = useCallback((f: File | undefined) => {
    if (!f) return
    // An invalid file leaves the current image and result alone.
    const err = validateFile(f)
    if (err) {
      setError(err)
      return
    }
    runId.current++
    failed.current = null
    setError('')
    setStatus('idle')
    setResult(null)
    setPalette([])
    setSelected(new Set())
    setView(INITIAL_VIEW)
    setSplit(50)
    setFile(f)
  }, [])

  const openPicker = () => fileInput.current?.click()

  const loadSample = async () => {
    try {
      onFile(await createSampleImage())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Files can be dropped anywhere on the page or pasted. Without this, a drop outside a drop
  // zone would make the browser open the image and discard the current work.
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
    const onPaste = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files[0]
      if (!f) return
      e.preventDefault()
      onFile(f)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [onFile])

  const selectedKey = keptKey(palette.filter((c) => selected.has(c.index)).map((c) => c.index))
  const attemptKey = `${colors}|${boundary}|${selectedKey}`

  const run = useCallback(async () => {
    if (!file) return
    const id = ++runId.current
    const key = attemptKey
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
        file,
        svg: out.svg,
        blob: new Blob([out.svg], { type: 'image/svg+xml' }),
        paths: countPaths(out.svg),
        colors,
        boundary,
        kept: keptKey(all.map((c) => c.index)),
      })
      setStatus('idle')
    } catch (e) {
      if (id !== runId.current) return
      failed.current = { file, key }
      setError((e as Error).message)
      setStatus('idle')
    }
  }, [file, colors, boundary, attemptKey, convert])

  const regenerate = useCallback(async () => {
    if (!file || !result) return
    const id = ++runId.current
    const key = attemptKey
    setError('')
    setStatus('converting')
    try {
      const kept = palette.filter((c) => selected.has(c.index)).map((c) => c.index)
      const out = await generate(kept, boundary)
      if (id !== runId.current) return
      setResult({
        ...result,
        svg: out.svg,
        blob: new Blob([out.svg], { type: 'image/svg+xml' }),
        paths: countPaths(out.svg),
        boundary,
        kept: keptKey(kept),
      })
      setStatus('idle')
    } catch (e) {
      if (id !== runId.current) return
      failed.current = { file, key }
      setError((e as Error).message)
      setStatus('idle')
    }
  }, [file, result, palette, selected, boundary, attemptKey, generate])

  // A different image or color count needs a new analysis; other changes only regenerate the SVG.
  const analyzeNeeded = !!file && (!result || result.file !== file || result.colors !== colors)
  const regenerateNeeded =
    !analyzeNeeded && !!result && (result.boundary !== boundary || result.kept !== selectedKey)

  // Settings apply by themselves: a new image converts at once, later changes once they settle.
  useEffect(() => {
    if (!file || engine !== 'ready') return
    if (!analyzeNeeded && !(regenerateNeeded && selectedKey !== '')) return
    const f = failed.current
    if (f && f.file === file && f.key === attemptKey) return
    const t = setTimeout(analyzeNeeded ? run : regenerate, result?.file === file ? SETTLE_MS : 0)
    return () => clearTimeout(t)
  }, [file, engine, result, analyzeNeeded, regenerateNeeded, selectedKey, attemptKey, run, regenerate])

  const retry = () => {
    failed.current = null
    if (analyzeNeeded) run()
    else regenerate()
  }

  const toggleColor = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  const download = () => {
    if (!svgUrl || !result) return
    const a = document.createElement('a')
    a.href = svgUrl
    a.download = result.file.name.replace(/\.[^.]+$/, '') + (result.boundary ? '-boundary' : '') + '.svg'
    a.click()
  }

  const copy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.svg)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('コードをコピーできませんでした。ブラウザがクリップボードへの書き込みを許可していない可能性があります。')
    }
  }

  const busy = status !== 'idle'
  const busyLabel = !busy
    ? null
    : status === 'decoding'
      ? '画像を読み込み中…'
      : mode === 'server'
        ? 'サーバーで変換中…'
        : '変換中…'
  const canRetry = !!error && !!file && !busy && engine === 'ready' && (analyzeNeeded || regenerateNeeded)
  const colorIndex = Math.max(0, COLOR_OPTIONS.indexOf(colors as (typeof COLOR_OPTIONS)[number]))
  const totalArea = palette.reduce((sum, c) => sum + c.area, 0)
  const zoomed = view.scale > MIN_SCALE

  const errorAlert = error && (
    <div className="alert error" role="alert">
      <span>エラー: {error}</span>
      {canRetry && (
        <button type="button" className="secondary small" onClick={retry}>
          再試行
        </button>
      )}
    </div>
  )
  const engineAlert = engine === 'failed' && (
    <p className="alert error" role="alert">
      変換エンジンの初期化に失敗しました: {engineError}
    </p>
  )

  return (
    <div className="app">
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg"
        tabIndex={-1}
        aria-label="画像ファイル"
        onChange={(e) => {
          onFile(e.target.files?.[0])
          // Lets the same file be picked again.
          e.target.value = ''
        }}
      />

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          ここにドロップして画像を読み込みます
        </div>
      )}

      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <span>SVG変換</span>
        </div>
        {file ? (
          <div className="topbar-file">
            <span className="mono file-meta">
              {file.name}
              {originalSize && ` ・ ${originalSize.width}×${originalSize.height}`}
            </span>
            <button type="button" className="secondary small" onClick={openPicker}>
              別の画像
            </button>
          </div>
        ) : (
          <nav className="topnav">
            <button type="button" className="link" onClick={() => setHelp('howto')}>
              使い方
            </button>
            <button type="button" className="link" onClick={() => setHelp('faq')}>
              よくある質問
            </button>
          </nav>
        )}
      </header>

      {!file || !originalUrl ? (
        <main className="landing">
          <div className="hero">
            <h1>画像を、拡大しても崩れないSVGに。</h1>
            <p className="only-wide">PNG・JPEGをドロップするだけ。登録不要・無料。</p>
            <p className="only-narrow">
              {mode === 'server' ? '登録不要・無料。' : '登録不要・無料。ブラウザだけで完結。'}
            </p>
          </div>

          <div
            className="drop-card"
            onClick={(e) => {
              // The buttons have their own actions; the rest of the card opens the picker.
              if (!(e.target as HTMLElement).closest('button')) openPicker()
            }}
          >
            <div className="drop-target">
              <span className="drop-icon" aria-hidden="true">
                ↑
              </span>
              <span className="drop-title only-wide">ここに画像をドロップ</span>
              <span className="drop-title only-narrow">タップして画像を選択</span>
              <span className="drop-hint mono">
                PNG / JPEG ・ 最大 {MAX_FILE_BYTES / 1024 / 1024} MB<span className="only-wide"> ・ Ctrl+V で貼り付けも可</span>
              </span>
            </div>
            <div className="drop-actions">
              <button type="button" className="large" onClick={openPicker}>
                <span className="only-wide">ファイルを選択</span>
                <span className="only-narrow">写真・ファイルを選ぶ</span>
              </button>
              <button type="button" className="secondary large" onClick={loadSample}>
                サンプルで試す
              </button>
            </div>
          </div>

          {engineAlert}
          {errorAlert}

          {mode === 'server' ? (
            <div className="privacy server" data-testid="privacy-notice">
              <span className="dot" aria-hidden="true" />
              画像は変換のためサーバーへ送信されます。機密性の高い画像や個人情報を含む画像はアップロードしないでください。
            </div>
          ) : (
            <div className="privacy" data-testid="privacy-notice">
              <span className="dot" aria-hidden="true" />
              <span className="only-wide">画像はブラウザ内で処理され、外部に送信されません</span>
              <span className="only-narrow">画像は外部に送信されません</span>
            </div>
          )}
          {mode === 'wasm' && engine === 'initializing' && (
            <p className="engine-note" role="status">
              変換エンジンを準備中…
            </p>
          )}
        </main>
      ) : (
        <main className="workspace">
          <section className="stage" aria-label="プレビュー">
            <div className="stage-bar">
              <div className="segmented" role="group" aria-label="表示">
                {(
                  [
                    ['compare', '比較'],
                    ['svg', 'SVGのみ'],
                    ['code', 'コード'],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={viewMode === m}
                    disabled={m === 'code' && !result}
                    onClick={() => setViewMode(m)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {viewMode !== 'code' && (
                <div className="zoom-controls">
                  <button
                    type="button"
                    className="secondary square"
                    aria-label="縮小"
                    disabled={!zoomed}
                    onClick={() => zoomFrameCenter(viewerRef.current, setView, 1 / ZOOM_STEP)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="zoom-level mono"
                    title="クリックで元の大きさに戻す"
                    aria-label={`拡大率 ${Math.round(view.scale * 100)}%（元に戻す）`}
                    onClick={() => setView(INITIAL_VIEW)}
                  >
                    {Math.round(view.scale * 100)}%
                  </button>
                  <button
                    type="button"
                    className="secondary square"
                    aria-label="拡大"
                    disabled={view.scale >= MAX_SCALE}
                    onClick={() => zoomFrameCenter(viewerRef.current, setView, ZOOM_STEP)}
                  >
                    +
                  </button>
                </div>
              )}
            </div>

            {engineAlert}
            {errorAlert}

            {viewMode === 'code' && result ? (
              <div className="code-view" tabIndex={0} aria-label="SVG のコード">
                <pre>
                  <code>{result.svg.slice(0, CODE_PREVIEW_CHARS)}</code>
                </pre>
                {result.svg.length > CODE_PREVIEW_CHARS && (
                  <p className="code-note">
                    先頭 {CODE_PREVIEW_CHARS.toLocaleString()} 文字のみ表示しています。全体は「コードをコピー」で取得できます。
                  </p>
                )}
              </div>
            ) : (
              <Viewer
                frameRef={viewerRef}
                original={originalUrl}
                svg={svgUrl}
                compare={viewMode === 'compare'}
                view={view}
                setView={setView}
                split={split}
                setSplit={setSplit}
                busyLabel={busyLabel}
              />
            )}
          </section>

          <aside className="settings" aria-label="変換設定">
            <div className="setting">
              <span className="setting-label" id="preset-label">
                用途
              </span>
              <div className="presets" role="group" aria-labelledby="preset-label">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="preset"
                    aria-pressed={colors === p.colors}
                    onClick={() => setColors(p.colors)}
                  >
                    <span className="preset-label">{p.label}</span>
                    <span className="preset-sub mono">{p.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <label className="setting">
              <span className="setting-row">
                <span className="setting-label">色数</span>
                <span className="mono">{colors}</span>
              </span>
              <input
                type="range"
                min={0}
                max={COLOR_OPTIONS.length - 1}
                step={1}
                value={colorIndex}
                aria-valuetext={`${colors} 色`}
                onChange={(e) => setColors(COLOR_OPTIONS[Number(e.target.value)])}
              />
              <span className="setting-row scale-labels only-wide">
                <span>シンプル</span>
                <span>リアル</span>
              </span>
            </label>

            <label className="switch-row">
              <span className="switch-text">
                <span className="switch-title">線だけで描く</span>
                <span className="switch-sub only-wide">塗りなし・輪郭のみ</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={boundary}
                onChange={(e) => setBoundary(e.target.checked)}
              />
            </label>

            {palette.length > 0 && (
              <details className="advanced">
                <summary className="mono">詳細設定</summary>
                <div className="advanced-body">
                  <div className="setting-row">
                    <span className="setting-label">使用する色</span>
                    <span className="palette-actions">
                      <button
                        type="button"
                        className="link small"
                        disabled={selected.size === palette.length}
                        onClick={() => setSelected(new Set(palette.map((c) => c.index)))}
                      >
                        すべて選択
                      </button>
                      <button
                        type="button"
                        className="link small"
                        disabled={selected.size === 0}
                        onClick={() => setSelected(new Set())}
                      >
                        すべて解除
                      </button>
                    </span>
                  </div>
                  <ul className="palette">
                    {palette.map((c) => {
                      const share = formatShare(c.area, totalArea)
                      return (
                        <li key={c.index}>
                          <label className="swatch-item">
                            <input
                              type="checkbox"
                              checked={selected.has(c.index)}
                              onChange={() => toggleColor(c.index)}
                              aria-label={`${c.hex}（${share}）`}
                            />
                            <span className="swatch" style={{ background: c.hex }} title={c.hex} />
                            <span className="share mono">{share}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                  {selected.size === 0 && <p className="hint">少なくとも 1 色を選択してください。</p>}
                </div>
              </details>
            )}

            <div className="actions">
              <div className="stats mono">
                <span>
                  <span className="only-wide">サイズ </span>
                  <b>{result ? formatBytes(result.blob.size) : '—'}</b>
                </span>
                <span>
                  <span className="only-wide">パス数 </span>
                  <b>{result ? result.paths.toLocaleString() : '—'}</b>
                  <span className="only-narrow"> paths</span>
                </span>
              </div>
              <button
                type="button"
                className="large primary-action"
                aria-label="SVGをダウンロード"
                disabled={!result}
                onClick={download}
              >
                <span className="only-wide">SVGをダウンロード</span>
                <span className="only-narrow">ダウンロード</span>
              </button>
              <button
                type="button"
                className="secondary large"
                aria-label={copied ? 'コピーしました' : 'コードをコピー'}
                disabled={!result}
                onClick={copy}
              >
                <span className="only-wide">{copied ? 'コピーしました' : 'コードをコピー'}</span>
                <span className="only-narrow">{copied ? '済' : 'コピー'}</span>
              </button>
            </div>
          </aside>
        </main>
      )}

      <HelpDialog topic={help} mode={mode} onClose={() => setHelp(null)} />
    </div>
  )
}

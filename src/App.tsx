import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { decodeImage } from './converter/decode.ts'
import { COLOR_OPTIONS, DEFAULT_COLORS, validateFile } from './converter/limits.ts'
import { useConverter } from './converter/useConverter.ts'

type Status = 'idle' | 'decoding' | 'converting' | 'done' | 'error'

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
  const { engine, engineError, convert } = useConverter()
  const [file, setFile] = useState<File | null>(null)
  const [colors, setColors] = useState<number>(DEFAULT_COLORS)
  const [boundary, setBoundary] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [svgBlob, setSvgBlob] = useState<Blob | null>(null)
  const [contours, setContours] = useState(0)
  const [split, setSplit] = useState(50)
  const [stale, setStale] = useState(false)
  const runId = useRef(0)

  const originalUrl = useObjectUrl(file)
  // The SVG is shown through <img>, so scripts inside it never run and it never enters the DOM.
  const svgUrl = useObjectUrl(svgBlob)

  const onFile = (f: File | undefined) => {
    runId.current++
    setSvgBlob(null)
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
      setSvgBlob(new Blob([out.svg], { type: 'image/svg+xml' }))
      setContours(out.contourCount)
      setStale(false)
      setStatus('done')
    } catch (e) {
      if (id !== runId.current) return
      setSvgBlob(null)
      setError((e as Error).message)
      setStatus('error')
    }
  }, [file, colors, boundary, convert])

  const busy = status === 'decoding' || status === 'converting'
  const canRun = !!file && engine === 'ready' && !busy
  const markStale = () => svgBlob && setStale(true)

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
        <p>ブラウザ内で WebAssembly を使って変換します。画像は外部に送信されません。</p>
        <p className={`badge engine-${engine}`} role="status">
          {engine === 'initializing' && '変換エンジンを初期化中…'}
          {engine === 'ready' && '変換エンジン準備完了'}
          {engine === 'failed' && `エンジンの初期化に失敗しました: ${engineError}`}
        </p>
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
          {status === 'decoding' ? '画像をデコード中…' : 'SVG に変換中…(画像が大きいと時間がかかります)'}
        </p>
      )}
      {status === 'error' && (
        <p className="badge error" role="alert">
          エラー: {error}
        </p>
      )}
      {stale && <p className="badge warn">設定が変更されました。「変換する」で再変換してください。</p>}

      <div className="grid">
        <section className="panel">
          <h2>元画像</h2>
          {originalUrl ? (
            <div className="frame">
              <img src={originalUrl} alt="選択した元画像" />
            </div>
          ) : (
            <p className="placeholder">画像を選択してください</p>
          )}
        </section>

        <section className="panel">
          <h2>
            SVG プレビュー
            {status === 'done' && <small> 輪郭 {contours.toLocaleString()} 件</small>}
          </h2>
          {svgUrl ? (
            <>
              <div className="frame">
                <img src={svgUrl} alt="変換後の SVG" />
              </div>
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

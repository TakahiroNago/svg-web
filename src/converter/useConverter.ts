import { useCallback, useEffect, useRef, useState } from 'react'
import type { PaletteColor } from '../wasm/svg-converter.js'
import { CONVERTER_MODE } from './config.ts'
import { convertRemote, rgbaToPng } from './remote.ts'
import type { WorkerRequest, WorkerResponse } from './worker.ts'

export type EngineState = 'initializing' | 'ready' | 'failed'

export type ConvertOutput = { svg: string; contourCount: number }

export type FullConvertOutput = ConvertOutput & { palette: PaletteColor[] }

type Pending = { resolve: (v: ConvertOutput | PaletteColor[]) => void; reject: (e: Error) => void }

// Fixed at build time. In server mode the Worker and the WASM module are never loaded,
// so an API failure cannot fall back to in-browser conversion.
const USE_REMOTE = CONVERTER_MODE === 'server'

export function useConverter() {
  const workerRef = useRef<Worker | null>(null)
  const pending = useRef(new Map<number, Pending>())
  const nextId = useRef(1)
  const remoteImage = useRef<{ png: Blob; colors: number } | null>(null)
  // Server mode has nothing to initialize; 'ready' only means the UI can send requests.
  const [engine, setEngine] = useState<EngineState>(USE_REMOTE ? 'ready' : 'initializing')
  const [engineError, setEngineError] = useState('')

  useEffect(() => {
    if (USE_REMOTE) return
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const pendingMap = pending.current

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data
      if (m.type === 'ready') setEngine('ready')
      else if (m.type === 'init-error') {
        setEngine('failed')
        setEngineError(m.error)
      } else {
        const p = pendingMap.get(m.id)
        pendingMap.delete(m.id)
        if (!p) return
        if (m.type === 'result') p.resolve({ svg: m.svg, contourCount: m.contourCount })
        else if (m.type === 'analyzed') p.resolve(m.palette)
        else p.reject(new Error(m.error))
      }
    }
    worker.onerror = (e) => {
      setEngine('failed')
      setEngineError(e.message || 'Worker の起動に失敗しました。')
      for (const p of pendingMap.values()) p.reject(new Error('Worker エラー'))
      pendingMap.clear()
    }

    return () => {
      worker.terminate()
      workerRef.current = null
      for (const p of pendingMap.values()) p.reject(new Error('キャンセルされました'))
      pendingMap.clear()
    }
  }, [])

  const postToWorker = useCallback(<T,>(req: WorkerRequest, transfer: Transferable[] = []) => {
    return new Promise<T>((resolve, reject) => {
      const worker = workerRef.current
      if (!worker) return reject(new Error('変換エンジンが利用できません。'))
      pending.current.set(req.id, { resolve: (v) => resolve(v as T), reject })
      worker.postMessage(req, transfer)
    })
  }, [])

  // Analyzes the image and generates the SVG with every color that has a non-zero area.
  const convert = useCallback(
    async (
      rgba: ArrayBuffer,
      width: number,
      height: number,
      colors: number,
      boundary: boolean,
    ): Promise<FullConvertOutput> => {
      if (USE_REMOTE) {
        const png = await rgbaToPng(rgba, width, height)
        // Empty kept_colors makes the engine keep every non-zero color in draw order, which is
        // exactly the selection the WASM path below makes, so one request is enough.
        const result = await convertRemote(png, colors, [], boundary)
        remoteImage.current = { png, colors }
        return result
      }
      const palette = await postToWorker<PaletteColor[]>(
        { type: 'analyze', id: nextId.current++, rgba, width, height, colors },
        [rgba],
      )
      const kept = palette.filter((c) => c.area > 0).map((c) => c.index)
      const out = await postToWorker<ConvertOutput>({ type: 'generate', id: nextId.current++, keptColors: kept, boundary })
      return { ...out, palette }
    },
    [postToWorker],
  )

  // Regenerates the SVG of the last converted image with a different color selection.
  const generate = useCallback(
    async (keptColors: number[], boundary: boolean): Promise<ConvertOutput> => {
      if (USE_REMOTE) {
        const image = remoteImage.current
        if (!image) throw new Error('先に画像を変換してください。')
        const { svg, contourCount } = await convertRemote(image.png, image.colors, keptColors, boundary)
        return { svg, contourCount }
      }
      return postToWorker<ConvertOutput>({ type: 'generate', id: nextId.current++, keptColors, boundary })
    },
    [postToWorker],
  )

  return { mode: CONVERTER_MODE, engine, engineError, convert, generate }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PaletteColor } from '../wasm/svg-converter.js'
import { CONVERTER_MODE } from './config.ts'
import { ConvertApiError, convertRemote } from './remote.ts'
import { encodeForUpload, stripMetadata } from './upload.ts'
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
  const remoteImage = useRef<{ image: Blob; colors: number } | null>(null)
  const remoteRequest = useRef<AbortController | null>(null)
  // Server mode has nothing to initialize; 'ready' only means the UI can send requests.
  const [engine, setEngine] = useState<EngineState>(USE_REMOTE ? 'ready' : 'initializing')
  const [engineError, setEngineError] = useState('')

  // Only the latest request may finish, so an older image can never replace remoteImage.
  // The engine may keep working on an aborted request until it finishes by itself.
  const cancel = useCallback(() => {
    remoteRequest.current?.abort()
    remoteRequest.current = null
  }, [])

  const beginRequest = useCallback(() => {
    cancel()
    const controller = new AbortController()
    remoteRequest.current = controller
    return controller.signal
  }, [cancel])

  useEffect(() => cancel, [cancel])

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
      file: File,
      rgba: ArrayBuffer,
      width: number,
      height: number,
      colors: number,
      boundary: boolean,
      resized: boolean,
    ): Promise<FullConvertOutput> => {
      if (USE_REMOTE) {
        const signal = beginRequest()
        // A reduced image only exists as pixels; the file itself is over the limits.
        const stripped = resized ? null : await stripMetadata(file)
        let image = stripped ?? (await encodeForUpload(rgba, width, height))
        // Empty kept_colors makes the engine keep every non-zero color in draw order, which is
        // exactly the selection the WASM path below makes, so one request is enough.
        let result: FullConvertOutput
        try {
          result = await convertRemote(image, colors, [], boundary, signal)
        } catch (e) {
          // The browser could decode this file but the API could not: send the decoded pixels.
          const unreadable = e instanceof ConvertApiError && (e.status === 415 || e.status === 422)
          if (!stripped || !unreadable) throw e
          image = await encodeForUpload(rgba, width, height)
          result = await convertRemote(image, colors, [], boundary, signal)
        }
        remoteImage.current = { image, colors }
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
    [postToWorker, beginRequest],
  )

  // Regenerates the SVG of the last converted image with a different color selection.
  const generate = useCallback(
    async (keptColors: number[], boundary: boolean): Promise<ConvertOutput> => {
      if (USE_REMOTE) {
        const image = remoteImage.current
        if (!image) throw new Error('先に画像を変換してください。')
        const { svg, contourCount } = await convertRemote(image.image, image.colors, keptColors, boundary, beginRequest())
        return { svg, contourCount }
      }
      return postToWorker<ConvertOutput>({ type: 'generate', id: nextId.current++, keptColors, boundary })
    },
    [postToWorker, beginRequest],
  )

  return { mode: CONVERTER_MODE, engine, engineError, convert, generate, cancel }
}

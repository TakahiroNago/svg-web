import { useCallback, useEffect, useRef, useState } from 'react'
import type { PaletteColor } from '../wasm/svg-converter.js'
import { API_BASE_URL, convertRemote, rgbaToPng } from './remote.ts'
import type { WorkerRequest, WorkerResponse } from './worker.ts'

export type EngineState = 'initializing' | 'ready' | 'failed'

export type ConvertOutput = { svg: string; contourCount: number }

type Pending = { resolve: (v: ConvertOutput | PaletteColor[]) => void; reject: (e: Error) => void }

const USE_REMOTE = API_BASE_URL !== ''

export function useConverter() {
  const workerRef = useRef<Worker | null>(null)
  const pending = useRef(new Map<number, Pending>())
  const nextId = useRef(1)
  const remoteImage = useRef<{ png: Blob; colors: number } | null>(null)
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

  const analyze = useCallback(
    async (rgba: ArrayBuffer, width: number, height: number, colors: number): Promise<PaletteColor[]> => {
      if (USE_REMOTE) {
        const png = await rgbaToPng(rgba, width, height)
        const result = await convertRemote(png, colors, [], false)
        remoteImage.current = { png, colors }
        return result.palette
      }
      return new Promise<PaletteColor[]>((resolve, reject) => {
        const worker = workerRef.current
        if (!worker) return reject(new Error('変換エンジンが利用できません。'))
        const id = nextId.current++
        pending.current.set(id, { resolve: (v) => resolve(v as PaletteColor[]), reject })
        const req: WorkerRequest = { type: 'analyze', id, rgba, width, height, colors }
        worker.postMessage(req, [rgba])
      })
    },
    [],
  )

  const generate = useCallback(
    async (keptColors: number[], boundary: boolean): Promise<ConvertOutput> => {
      if (USE_REMOTE) {
        const image = remoteImage.current
        if (!image) throw new Error('先に画像を変換してください。')
        const { svg, contourCount } = await convertRemote(image.png, image.colors, keptColors, boundary)
        return { svg, contourCount }
      }
      return new Promise<ConvertOutput>((resolve, reject) => {
        const worker = workerRef.current
        if (!worker) return reject(new Error('変換エンジンが利用できません。'))
        const id = nextId.current++
        pending.current.set(id, { resolve: (v) => resolve(v as ConvertOutput), reject })
        const req: WorkerRequest = { type: 'generate', id, keptColors, boundary }
        worker.postMessage(req)
      })
    },
    [],
  )

  return { engine, engineError, analyze, generate }
}

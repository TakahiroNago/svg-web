import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkerRequest, WorkerResponse } from './worker.ts'

export type EngineState = 'initializing' | 'ready' | 'failed'

export type ConvertOutput = { svg: string; contourCount: number }

export function useConverter() {
  const workerRef = useRef<Worker | null>(null)
  const pending = useRef(
    new Map<number, { resolve: (v: ConvertOutput) => void; reject: (e: Error) => void }>(),
  )
  const nextId = useRef(1)
  const [engine, setEngine] = useState<EngineState>('initializing')
  const [engineError, setEngineError] = useState('')

  useEffect(() => {
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

  const convert = useCallback(
    (rgba: ArrayBuffer, width: number, height: number, colors: number, boundary: boolean) =>
      new Promise<ConvertOutput>((resolve, reject) => {
        const worker = workerRef.current
        if (!worker) return reject(new Error('変換エンジンが利用できません。'))
        const id = nextId.current++
        pending.current.set(id, { resolve, reject })
        const req: WorkerRequest = { id, rgba, width, height, colors, boundary }
        worker.postMessage(req, [rgba])
      }),
    [],
  )

  return { engine, engineError, convert }
}

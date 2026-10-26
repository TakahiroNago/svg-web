import createSvgConverterModule, { type SvgConverterModule } from '../wasm/svg-converter.js'
import wasmUrl from '../wasm/svg-converter.wasm?url'

export type WorkerRequest = {
  id: number
  rgba: ArrayBuffer
  width: number
  height: number
  colors: number
  boundary: boolean
}

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'init-error'; error: string }
  | { type: 'result'; id: number; svg: string; contourCount: number }
  | { type: 'error'; id: number; error: string }

const ctx = self as unknown as {
  postMessage(message: WorkerResponse): void
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
}

const modulePromise: Promise<SvgConverterModule> = createSvgConverterModule({
  locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : path),
})

modulePromise.then(
  () => ctx.postMessage({ type: 'ready' }),
  (e) => ctx.postMessage({ type: 'init-error', error: String(e?.message ?? e) }),
)

ctx.onmessage = async (e) => {
  const { id, rgba, width, height, colors, boundary } = e.data
  try {
    const mod = await modulePromise
    const r = mod.convertImage(new Uint8Array(rgba), width, height, colors, [], boundary)
    if (r.success) {
      ctx.postMessage({ type: 'result', id, svg: r.svg, contourCount: r.contourCount })
    } else {
      ctx.postMessage({ type: 'error', id, error: r.error || '変換に失敗しました。' })
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', id, error: String((err as Error)?.message ?? err) })
  }
}

import createSvgConverterModule, {
  type PaletteColor,
  type SvgConverterModule,
  type SvgSession,
} from '../wasm/svg-converter.js'
import wasmUrl from '../wasm/svg-converter.wasm?url'

export type WorkerRequest =
  | { type: 'analyze'; id: number; rgba: ArrayBuffer; width: number; height: number; colors: number }
  | { type: 'generate'; id: number; keptColors: number[]; boundary: boolean }

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'init-error'; error: string }
  | { type: 'analyzed'; id: number; palette: PaletteColor[] }
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

let session: SvgSession | null = null

ctx.onmessage = async (e) => {
  const req = e.data
  try {
    const mod = await modulePromise
    if (req.type === 'analyze') {
      session?.delete()
      session = new mod.SvgSession()
      const r = session.analyze(new Uint8Array(req.rgba), req.width, req.height, req.colors)
      if (!r.success) {
        session.delete()
        session = null
        ctx.postMessage({ type: 'error', id: req.id, error: r.error || '解析に失敗しました。' })
        return
      }
      ctx.postMessage({ type: 'analyzed', id: req.id, palette: r.palette })
    } else {
      if (!session) throw new Error('先に画像を変換してください。')
      const r = session.generate(req.keptColors, req.boundary)
      if (r.success) {
        ctx.postMessage({ type: 'result', id: req.id, svg: r.svg, contourCount: r.contourCount })
      } else {
        ctx.postMessage({ type: 'error', id: req.id, error: r.error || '変換に失敗しました。' })
      }
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', id: req.id, error: String((err as Error)?.message ?? err) })
  }
}

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import type { WorkerRequest, WorkerResponse } from './converter/worker.ts'
import { clickConvert, palette, selectImage, stubObjectUrls } from './test/app.ts'

vi.mock('./converter/config.ts', () => ({ CONVERTER_MODE: 'wasm', API_BASE_URL: '' }))
vi.mock('./converter/decode.ts', () => ({
  decodeImage: vi.fn(async () => ({ rgba: new ArrayBuffer(16), width: 2, height: 2 })),
}))

// Stands in for worker.ts. The real WASM module is covered by src/wasm/svg-converter.test.ts.
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  received: WorkerRequest[] = []

  constructor() {
    FakeWorker.instances.push(this)
    queueMicrotask(() => this.reply({ type: 'ready' }))
  }

  postMessage(req: WorkerRequest) {
    this.received.push(req)
    queueMicrotask(() => {
      if (req.type === 'analyze') this.reply({ type: 'analyzed', id: req.id, palette })
      else this.reply({ type: 'result', id: req.id, svg: '<svg/>', contourCount: 2 })
    })
  }

  terminate() {}

  private reply(data: WorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<WorkerResponse>)
  }
}

beforeEach(() => {
  stubObjectUrls()
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('wasm mode', () => {
  it('says that images stay in the browser', async () => {
    render(<App />)

    expect(screen.getByTestId('privacy-notice')).toHaveTextContent(
      'ブラウザ内で WebAssembly を使って変換します。画像は外部に送信されません。',
    )
    expect(screen.queryByText(/サーバーへ送信されます/)).toBeNull()
    expect(await screen.findByText('変換エンジン準備完了')).toBeInTheDocument()
  })

  it('converts in the worker without calling the API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await screen.findByText('変換エンジン準備完了')

    selectImage()
    clickConvert()

    expect(await screen.findByAltText('変換後の SVG')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    const worker = FakeWorker.instances.at(-1)!
    expect(worker.received.map((r) => r.type)).toEqual(['analyze', 'generate'])
    // Same selection as before the change: every color with pixels, in palette order.
    expect(worker.received[1]).toMatchObject({ type: 'generate', keptColors: [1, 0], boundary: false })
  })
})

import { act, fireEvent, render, screen } from '@testing-library/react'
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

  it('names the download after the settings the SVG was generated with', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<App />)
    await screen.findByText('変換エンジン準備完了')

    selectImage()
    clickConvert()
    await screen.findByAltText('変換後の SVG')
    // Toggled after converting, so the shown SVG still has fills.
    fireEvent.click(screen.getByLabelText('境界線モード(塗りなし)'))
    fireEvent.click(screen.getByRole('button', { name: 'SVG をダウンロード' }))

    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('logo.svg')
    click.mockRestore()
  })

  it('asks for the right action after a setting changes', async () => {
    render(<App />)
    await screen.findByText('変換エンジン準備完了')
    selectImage()
    clickConvert()
    await screen.findByAltText('変換後の SVG')

    fireEvent.click(screen.getByTitle('#0000ff'))
    expect(screen.getByText(/「再変換」を押すと/)).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('#0000ff'))
    expect(screen.queryByText(/「再変換」を押すと/)).toBeNull()

    fireEvent.change(screen.getByLabelText('色数'), { target: { value: '4' } })
    expect(screen.getByText(/「変換する」を押すと/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再変換' })).toBeDisabled()
  })

  it('selects and clears every color at once', async () => {
    render(<App />)
    await screen.findByText('変換エンジン準備完了')
    selectImage()
    clickConvert()
    await screen.findByAltText('変換後の SVG')

    fireEvent.click(screen.getByRole('button', { name: 'すべて解除' }))
    expect(screen.getByRole('button', { name: '再変換' })).toBeDisabled()
    expect(screen.getByText('少なくとも 1 色を選択してください。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(screen.getByRole('checkbox', { name: '#ff0000（62.5%）' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '#0000ff（37.5%）' })).toBeChecked()
  })

  it('loads a file dropped anywhere on the page', () => {
    render(<App />)
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'dropped.png', { type: 'image/png' })
    const drop = new Event('drop', { cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [file] } })

    act(() => {
      window.dispatchEvent(drop)
    })

    expect(drop.defaultPrevented).toBe(true)
    expect(screen.getByText(/dropped\.png/)).toBeInTheDocument()
  })
})

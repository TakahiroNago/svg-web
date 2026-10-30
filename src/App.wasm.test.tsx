import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import type { WorkerRequest, WorkerResponse } from './converter/worker.ts'
import { palette, selectImage, stubObjectUrls } from './test/app.ts'

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
      else this.reply({ type: 'result', id: req.id, svg: '<svg><path/><path/></svg>', contourCount: 5 })
    })
  }

  terminate() {}

  private reply(data: WorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<WorkerResponse>)
  }
}

const worker = () => FakeWorker.instances.at(-1)!

async function loadAndConvert() {
  render(<App />)
  selectImage()
  await screen.findByAltText('変換後の SVG')
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

    expect(screen.getByTestId('privacy-notice')).toHaveTextContent('画像はブラウザ内で処理され、外部に送信されません')
    expect(screen.queryByText(/サーバーへ送信されます/)).toBeNull()
    await waitFor(() => expect(screen.queryByText('変換エンジンを準備中…')).toBeNull())
  })

  it('converts a loaded image in the worker without calling the API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await loadAndConvert()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(worker().received.map((r) => r.type)).toEqual(['analyze', 'generate'])
    // Same selection as before the change: every color with pixels, in palette order.
    expect(worker().received[1]).toMatchObject({ type: 'generate', keptColors: [1, 0], boundary: false })
    // One <path> per color, counted from the SVG rather than taken from the contour count.
    expect(screen.getByText('パス数').parentElement).toHaveTextContent('2')
  })

  it('re-analyzes on a color count change and only regenerates on other changes', async () => {
    await loadAndConvert()

    fireEvent.change(screen.getByLabelText(/色数/), { target: { value: '2' } })
    await waitFor(() => expect(worker().received).toHaveLength(4))
    expect(worker().received[2]).toMatchObject({ type: 'analyze', colors: 4 })

    fireEvent.click(screen.getByRole('switch', { name: /線だけで描く/ }))
    await waitFor(() => expect(worker().received).toHaveLength(5))
    expect(worker().received[4]).toMatchObject({ type: 'generate', boundary: true })
  })

  it('marks the preset matching the color count', async () => {
    await loadAndConvert()

    fireEvent.click(screen.getByRole('button', { name: /イラスト/ }))

    expect(screen.getByRole('button', { name: /イラスト/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /ロゴ/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText(/色数/)).toHaveAttribute('aria-valuetext', '12 色')
  })

  it('names the download after the settings the SVG was generated with', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await loadAndConvert()

    fireEvent.click(screen.getByRole('switch', { name: /線だけで描く/ }))
    // Until the new SVG arrives, the shown one still has fills.
    fireEvent.click(screen.getByRole('button', { name: 'SVGをダウンロード' }))
    await waitFor(() => expect(worker().received).toHaveLength(3))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'SVGをダウンロード' }))

    expect(click.mock.contexts.map((a) => (a as HTMLAnchorElement).download)).toEqual([
      'logo.svg',
      'logo-boundary.svg',
    ])
    click.mockRestore()
  })

  it('selects and clears every color at once', async () => {
    await loadAndConvert()

    fireEvent.click(screen.getByRole('button', { name: 'すべて解除' }))
    expect(screen.getByText('少なくとも 1 色を選択してください。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(screen.getByRole('checkbox', { name: '#ff0000（62.5%）' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '#0000ff（37.5%）' })).toBeChecked()
  })

  it('shows the SVG code and copies it', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await loadAndConvert()

    fireEvent.click(screen.getByRole('button', { name: 'コード' }))
    expect(screen.getByLabelText('SVG のコード')).toHaveTextContent('<svg><path/><path/></svg>')

    fireEvent.click(screen.getByRole('button', { name: 'コードをコピー' }))
    expect(await screen.findByRole('button', { name: 'コピーしました' })).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith('<svg><path/><path/></svg>')
  })

  it('keeps the current image when an unsupported file is chosen', async () => {
    await loadAndConvert()

    selectImage('anim.gif', 'image/gif')

    expect(screen.getByRole('alert')).toHaveTextContent('PNG または JPEG ファイルを選択してください。')
    expect(screen.getByAltText('変換後の SVG')).toBeInTheDocument()
  })

  it('loads a file dropped anywhere on the page', async () => {
    render(<App />)
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'dropped.png', { type: 'image/png' })
    const drop = new Event('drop', { cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [file] } })

    act(() => {
      window.dispatchEvent(drop)
    })

    expect(drop.defaultPrevented).toBe(true)
    expect(await screen.findByText(/dropped\.png/)).toBeInTheDocument()
  })

  it('loads a pasted image', async () => {
    render(<App />)
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'pasted.png', { type: 'image/png' })
    const paste = new Event('paste', { cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: { files: [file] } })

    act(() => {
      window.dispatchEvent(paste)
    })

    expect(await screen.findByText(/pasted\.png/)).toBeInTheDocument()
  })

  it('opens the how-to and FAQ', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '使い方' }))
    expect(screen.getByRole('heading', { name: '使い方' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('heading', { name: '使い方' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'よくある質問' }))
    expect(screen.getByText('画像はどこで処理されますか？')).toBeInTheDocument()
    expect(screen.getByText(/画像が外部に送信されることはありません/)).toBeInTheDocument()
  })
})

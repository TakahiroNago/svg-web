import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { palette, selectImage, stubObjectUrls } from './test/app.ts'

vi.mock('./converter/config.ts', () => ({ CONVERTER_MODE: 'server', API_BASE_URL: '' }))
vi.mock('./converter/decode.ts', () => ({
  decodeImage: vi.fn(async () => ({ rgba: new ArrayBuffer(16), width: 2, height: 2 })),
}))
// jsdom cannot encode PNGs; the request itself still goes through the real convertRemote.
vi.mock('./converter/remote.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./converter/remote.ts')>()),
  rgbaToPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
}))

const WorkerSpy = vi.fn()

function okResponse() {
  return new Response(JSON.stringify({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', contourCount: 4, palette }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sentForm(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  return (fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].body as FormData
}

// Longer than the settle delay after a settings change.
const settled = () => new Promise((r) => setTimeout(r, 600))

beforeEach(() => {
  stubObjectUrls()
  WorkerSpy.mockClear()
  // Any attempt to start the WASM worker would show up here.
  vi.stubGlobal('Worker', WorkerSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('server mode', () => {
  it('says that images are sent to the server', () => {
    render(<App />)

    expect(screen.getByTestId('privacy-notice')).toHaveTextContent('画像は変換のためサーバーへ送信されます')
    expect(screen.getByTestId('privacy-notice')).toHaveTextContent('機密性の高い画像')
    expect(screen.queryByText(/画像は外部に送信されません/)).toBeNull()
    expect(screen.queryByText('変換エンジンを準備中…')).toBeNull()
  })

  it('converts a loaded image with a single API request and never starts the WASM worker', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    selectImage()

    expect(await screen.findByAltText('変換後の SVG')).toBeInTheDocument()
    await settled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/v1/convert')
    const form = sentForm(fetchMock, 0)
    expect(form.get('colors')).toBe('8')
    expect(form.get('boundary')).toBe('false')
    expect(form.has('kept_colors')).toBe(false)
    // Colors without pixels are not offered for selection, as before.
    expect(document.querySelectorAll('.palette input[type="checkbox"]')).toHaveLength(2)
    expect(WorkerSpy).not.toHaveBeenCalled()
  })

  it('re-sends the image when 線だけで描く is switched on', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    selectImage()
    await screen.findByAltText('変換後の SVG')

    fireEvent.click(screen.getByRole('switch', { name: /線だけで描く/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(sentForm(fetchMock, 1).get('boundary')).toBe('true')
  })

  it('re-sends the image with the selected colors', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    selectImage()
    await screen.findByAltText('変換後の SVG')

    fireEvent.click(screen.getByTitle('#0000ff'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(sentForm(fetchMock, 1).get('kept_colors')).toBe('1')
  })

  it('sends one request after quick successive setting changes', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    selectImage()
    await screen.findByAltText('変換後の SVG')

    fireEvent.click(screen.getByRole('button', { name: /イラスト/ }))
    fireEvent.click(screen.getByRole('button', { name: /写真/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await settled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sentForm(fetchMock, 1).get('colors')).toBe('24')
  })

  it('shows the API error, does not retry by itself, and does not fall back to WASM', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'The conversion engine is unavailable.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    selectImage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('変換エンジンが一時的に利用できません')
    expect(alert).toHaveTextContent('HTTP 503')
    expect(alert).not.toHaveTextContent('unavailable')
    expect(screen.queryByAltText('変換後の SVG')).toBeNull()
    await settled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(WorkerSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('shows a connection error when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    render(<App />)

    selectImage()

    expect(await screen.findByRole('alert')).toHaveTextContent('変換サーバーに接続できませんでした')
    expect(WorkerSpy).not.toHaveBeenCalled()
  })
})

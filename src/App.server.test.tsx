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

const choose = (file: File) =>
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })

const bytes = async (b: Blob) => [...new Uint8Array(await b.arrayBuffer())]

const sentBytes = (fetchMock: ReturnType<typeof vi.fn>, call: number) => bytes(sentForm(fetchMock, call).get('file') as File)

const IMAGE_START = [0xff, 0xd8]
const IMAGE_BODY = [0xff, 0xc0, 0, 3, 8, 0xff, 0xda, 0, 2, 0x12, 0xff, 0xd9]
const JPEG_WITHOUT_METADATA = [...IMAGE_START, ...IMAGE_BODY]

// EXIF with an Orientation tag, followed by bytes standing in for GPS and camera data.
function exifSegment(orientation: number) {
  const secret = [...'GPS-35.68N-Canon'].map((c) => c.charCodeAt(0))
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0, ...secret]
  return [0xff, 0xe1, 0, body.length + 2, ...body]
}

const jpegFile = (name: string, metadata: number[]) =>
  new File([new Uint8Array([...IMAGE_START, ...metadata, ...IMAGE_BODY])], name, { type: 'image/jpeg' })

const pngFile = (name: string) => {
  const chunk = (type: string) => [0, 0, 0, 0, ...[...type].map((c) => c.charCodeAt(0)), 1, 2, 3, 4]
  const file = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR'), ...chunk('IDAT'), ...chunk('IEND')]
  return new File([new Uint8Array(file)], name, { type: 'image/png' })
}

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

  it('sends the image without its metadata, and re-sends the same bytes', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    choose(jpegFile('photo.jpg', exifSegment(1)))
    await screen.findByAltText('変換後の SVG')

    expect(await sentBytes(fetchMock, 0)).toEqual(JPEG_WITHOUT_METADATA)
    expect((sentForm(fetchMock, 0).get('file') as File).name).toBe('image')

    fireEvent.click(screen.getByRole('switch', { name: /線だけで描く/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(await sentBytes(fetchMock, 1)).toEqual(JPEG_WITHOUT_METADATA)
  })

  it('sends the decoded pixels for an image rotated by EXIF, so no metadata goes with them', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    choose(jpegFile('photo.jpg', exifSegment(6)))
    await screen.findByAltText('変換後の SVG')

    expect(await (sentForm(fetchMock, 0).get('file') as File).text()).toBe('png')
  })

  it('falls back to the decoded pixels when the API cannot read the file', async () => {
    const fetchMock = vi
      .fn(async () => okResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'bad' }), { status: 422 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    choose(jpegFile('photo.jpg', []))

    await screen.findByAltText('変換後の SVG')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await sentBytes(fetchMock, 0)).toEqual(JPEG_WITHOUT_METADATA)
    expect(await (sentForm(fetchMock, 1).get('file') as File).text()).toBe('png')
  })

  describe('when another image is chosen during a conversion', () => {
    // The first request stays open until finished; `aborted` records what the browser would do.
    function slowFirstRequest(response = '{"svg":"<svg data-from=\\"a\\"/>","contourCount":1,"palette":[]}') {
      let finish: () => void = () => {}
      let signal: AbortSignal | undefined
      const fetchMock = vi.fn(async () => okResponse())
      fetchMock.mockImplementationOnce(
        (...args: unknown[]) =>
          new Promise<Response>((resolve) => {
            signal = (args[1] as RequestInit).signal ?? undefined
            finish = () => resolve(new Response(response, { status: 200 }))
          }),
      )
      vi.stubGlobal('fetch', fetchMock)
      return { fetchMock, finish: () => finish(), aborted: () => signal?.aborted }
    }

    const A = () => jpegFile('a.jpg', [])
    const B = () => pngFile('b.png')

    it('aborts the older request', async () => {
      const { fetchMock, aborted } = slowFirstRequest()
      render(<App />)
      choose(A())
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(aborted()).toBe(false)

      choose(B())

      expect(aborted()).toBe(true)
      await screen.findByAltText('変換後の SVG')
    })

    it('keeps the newer image when the older response still arrives', async () => {
      const { fetchMock, finish } = slowFirstRequest()
      render(<App />)
      choose(A())
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      choose(B())
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      const shown = (await screen.findByAltText('変換後の SVG')).getAttribute('src')

      finish()
      await settled()

      expect(screen.getByAltText('変換後の SVG').getAttribute('src')).toBe(shown)
      expect(screen.queryByRole('alert')).toBeNull()

      // A later change has to re-send B, not A.
      fireEvent.click(screen.getByTitle('#0000ff'))
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
      expect(await sentBytes(fetchMock, 2)).toEqual(await bytes(B()))
    })

    it('shows no error for the aborted request', async () => {
      const fetchMock = vi.fn(async () => okResponse())
      fetchMock.mockImplementationOnce(
        (...args: unknown[]) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = (args[1] as RequestInit).signal!
            signal.addEventListener('abort', () => reject(signal.reason))
          }),
      )
      vi.stubGlobal('fetch', fetchMock)
      render(<App />)
      choose(A())
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

      choose(B())

      await screen.findByAltText('変換後の SVG')
      await settled()
      expect(screen.queryByRole('alert')).toBeNull()
    })
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

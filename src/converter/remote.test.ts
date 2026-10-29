import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConvertApiError, convertRemote, messageForStatus } from './remote.ts'

vi.mock('./config.ts', () => ({ CONVERTER_MODE: 'server', API_BASE_URL: '' }))

const png = new Blob(['png'], { type: 'image/png' })
const ok = { svg: '<svg/>', contourCount: 3, palette: [{ index: 0, hex: '#000000', area: 4 }] }

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function captureError(p: Promise<unknown>): Promise<ConvertApiError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(ConvertApiError)
  return err as ConvertApiError
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('convertRemote', () => {
  it('posts the image to /api/v1/convert on the same origin', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, ok))
    vi.stubGlobal('fetch', fetchMock)

    await expect(convertRemote(png, 8, [], true)).resolves.toEqual(ok)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/convert')
    expect(init.method).toBe('POST')
    const form = init.body as FormData
    expect(form.get('colors')).toBe('8')
    expect(form.get('boundary')).toBe('true')
    expect(form.has('kept_colors')).toBe(false)
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('sends kept_colors when a selection is given', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, ok))
    vi.stubGlobal('fetch', fetchMock)

    await convertRemote(png, 8, [2, 0], false)

    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData
    expect(form.get('kept_colors')).toBe('2,0')
  })

  it('reports a network failure separately from HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))

    const err = await captureError(convertRemote(png, 8, [], false))
    expect(err.kind).toBe('network')
    expect(err.status).toBeUndefined()
    expect(err.message).toContain('変換サーバーに接続できませんでした')
  })

  it('replaces the English API error with a Japanese message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(415, { error: 'only PNG and JPEG images are supported' })))

    const err = await captureError(convertRemote(png, 8, [], false))
    expect(err.kind).toBe('http')
    expect(err.status).toBe(415)
    expect(err.message).toBe('PNG または JPEG 画像のみ変換できます。(HTTP 415)')
    expect(err.message).not.toMatch(/supported/)
  })

  it('handles a non-JSON error page from Nginx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 })))

    const err = await captureError(convertRemote(png, 8, [], false))
    expect(err.kind).toBe('http')
    expect(err.message).toBe('変換サーバーで処理に失敗しました。(HTTP 502)')
  })

  it.each([
    [200, 'not json'],
    [200, JSON.stringify({ svg: '<svg/>' })],
  ])('rejects an unexpected success body (%i %s)', async (status, body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })))

    const err = await captureError(convertRemote(png, 8, [], false))
    expect(err.kind).toBe('invalid-response')
  })
})

describe('messageForStatus', () => {
  it.each([400, 404, 413, 415, 422, 429, 500, 502, 503, 504, 418])('gives a Japanese message for %i', (status) => {
    const message = messageForStatus(status)
    expect(message).toContain(`(HTTP ${status})`)
    expect(message).toMatch(/[ぁ-んァ-ン]/)
  })

  it('distinguishes the main failure causes', () => {
    expect(messageForStatus(413)).toContain('大きすぎます')
    expect(messageForStatus(429)).toContain('混み合っています')
    expect(messageForStatus(503)).toContain('利用できません')
    expect(messageForStatus(504)).toContain('タイムアウト')
  })
})

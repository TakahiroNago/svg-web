import type { PaletteColor } from '../wasm/svg-converter.js'
import { API_BASE_URL } from './config.ts'
import { MAX_FILE_BYTES, MAX_PIXELS, MAX_SIDE } from './limits.ts'

// Server-side conversion through the Go API (VITE_CONVERTER_MODE=server).
// Failures are reported as ConvertApiError and never fall back to WASM.

export type RemoteResult = { svg: string; contourCount: number; palette: PaletteColor[] }

export type ConvertApiErrorKind = 'network' | 'http' | 'invalid-response'

export class ConvertApiError extends Error {
  readonly kind: ConvertApiErrorKind
  readonly status?: number

  constructor(kind: ConvertApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ConvertApiError'
    this.kind = kind
    this.status = status
  }
}

export const CONVERT_ENDPOINT = `${API_BASE_URL}/api/v1/convert`

// The Go API answers in English; users see these messages instead.
export function messageForStatus(status: number): string {
  const suffix = `(HTTP ${status})`
  switch (status) {
    case 400:
      return `画像または変換設定がサーバーに受け付けられませんでした。${suffix}`
    case 404:
    case 405:
      return `変換APIが見つかりません。サーバーの設定を確認してください。${suffix}`
    case 413:
      return `画像が大きすぎます。${MAX_FILE_BYTES / 1024 / 1024} MB 以下、1辺 ${MAX_SIDE}px 以下、合計 ${MAX_PIXELS.toLocaleString()} 画素以下にしてください。${suffix}`
    case 415:
      return `PNG または JPEG 画像のみ変換できます。${suffix}`
    case 422:
      return `サーバーで画像を読み込めませんでした。ファイルが壊れている可能性があります。${suffix}`
    case 429:
      return `変換サーバーが混み合っています。しばらくしてから再度お試しください。${suffix}`
    case 502:
      return `変換サーバーで処理に失敗しました。${suffix}`
    case 503:
      return `変換エンジンが一時的に利用できません。しばらくしてから再度お試しください。${suffix}`
    case 504:
      return `変換がタイムアウトしました。色数を減らすか、小さい画像でお試しください。${suffix}`
    default:
      return status >= 500
        ? `変換サーバーでエラーが発生しました。${suffix}`
        : `変換サーバーがリクエストを受け付けませんでした。${suffix}`
  }
}

function isRemoteResult(v: unknown): v is RemoteResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.svg === 'string' &&
    typeof r.contourCount === 'number' &&
    Array.isArray(r.palette) &&
    r.palette.every(
      (c) =>
        typeof c === 'object' &&
        c !== null &&
        typeof c.index === 'number' &&
        typeof c.hex === 'string' &&
        typeof c.area === 'number',
    )
  )
}

export async function rgbaToPng(rgba: ArrayBuffer, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const c2d = canvas.getContext('2d')
  if (!c2d) throw new Error('Canvas を利用できません。')
  c2d.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像のエンコードに失敗しました。'))), 'image/png'),
  )
}

export async function convertRemote(
  png: Blob,
  colors: number,
  keptColors: number[],
  boundary: boolean,
): Promise<RemoteResult> {
  const form = new FormData()
  form.set('file', png, 'image.png')
  form.set('colors', String(colors))
  form.set('boundary', String(boundary))
  // Empty means every color with a non-zero area, in draw order.
  if (keptColors.length > 0) form.set('kept_colors', keptColors.join(','))

  let res: Response
  try {
    res = await fetch(CONVERT_ENDPOINT, { method: 'POST', body: form })
  } catch {
    throw new ConvertApiError(
      'network',
      '変換サーバーに接続できませんでした。ネットワーク接続を確認するか、しばらくしてから再度お試しください。',
    )
  }
  if (!res.ok) throw new ConvertApiError('http', messageForStatus(res.status), res.status)

  const body: unknown = await res.json().catch(() => null)
  if (!isRemoteResult(body)) {
    throw new ConvertApiError('invalid-response', '変換サーバーから想定外の応答を受け取りました。', res.status)
  }
  return body
}

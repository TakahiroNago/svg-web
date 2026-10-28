import type { PaletteColor } from '../wasm/svg-converter.js'

// Server-side conversion through the Go API. Enabled only when VITE_API_BASE_URL is set;
// otherwise the app keeps converting in the browser with WASM.
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export type RemoteResult = { svg: string; contourCount: number; palette: PaletteColor[] }

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
  if (keptColors.length > 0) form.set('kept_colors', keptColors.join(','))

  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/api/v1/convert`, { method: 'POST', body: form })
  } catch {
    throw new Error('変換サーバーに接続できませんでした。')
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? `変換サーバーがエラーを返しました(${res.status})。`)
  return body as RemoteResult
}

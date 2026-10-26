import { validateDimensions } from './limits.ts'

export type DecodedImage = { rgba: ArrayBuffer; width: number; height: number }

// Decodes in the browser and returns straight (non-premultiplied) RGBA, as the WASM API expects.
export async function decodeImage(file: File): Promise<DecodedImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  } catch {
    throw new Error('画像をデコードできませんでした。ファイルが壊れている可能性があります。')
  }
  try {
    const dimError = validateDimensions(bitmap.width, bitmap.height)
    if (dimError) throw new Error(dimError)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const c2d = canvas.getContext('2d', { willReadFrequently: true })
    if (!c2d) throw new Error('Canvas を利用できません。')
    c2d.drawImage(bitmap, 0, 0)
    const data = c2d.getImageData(0, 0, bitmap.width, bitmap.height)
    return { rgba: data.data.buffer as ArrayBuffer, width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

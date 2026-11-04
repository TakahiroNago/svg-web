import { fitWithinLimits, validateDimensions } from './limits.ts'

export type DecodedImage = {
  rgba: ArrayBuffer
  width: number
  height: number
  /** The size of the file's image when it had to be reduced to fit the limits. */
  resizedFrom: { width: number; height: number } | null
}

// Decodes in the browser and returns straight (non-premultiplied) RGBA, as the WASM API expects.
// Images over the limits are reduced here, so both converter modes receive the same pixels.
export async function decodeImage(file: File): Promise<DecodedImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  } catch {
    throw new Error('画像をデコードできませんでした。ファイルが壊れている可能性があります。')
  }
  try {
    const { width, height } = fitWithinLimits(bitmap.width, bitmap.height)
    const dimError = validateDimensions(width, height)
    if (dimError) throw new Error(dimError)
    const resized = width !== bitmap.width || height !== bitmap.height
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const c2d = canvas.getContext('2d', { willReadFrequently: true })
    if (!c2d) throw new Error('Canvas を利用できません。')
    c2d.imageSmoothingQuality = 'high'
    c2d.drawImage(bitmap, 0, 0, width, height)
    const data = c2d.getImageData(0, 0, width, height)
    return {
      rgba: data.data.buffer as ArrayBuffer,
      width,
      height,
      resizedFrom: resized ? { width: bitmap.width, height: bitmap.height } : null,
    }
  } finally {
    bitmap.close()
  }
}

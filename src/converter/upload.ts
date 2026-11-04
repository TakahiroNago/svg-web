import { MAX_FILE_BYTES } from './limits.ts'
import { rgbaToJpeg, rgbaToPng } from './remote.ts'

// Decides what server mode uploads. The original file is preferred: re-encoding a 9,000,000-pixel
// photo as PNG can exceed the upload limit even when the original is far below it.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function ascii(view: DataView, offset: number, length: number): string {
  let s = ''
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

// PNG orientation lives in an eXIf chunk, which may follow the image data.
function pngHasExif(view: DataView): boolean {
  let p = PNG_SIGNATURE.length
  while (p + 8 <= view.byteLength) {
    if (ascii(view, p + 4, 4) === 'eXIf') return true
    p += 12 + view.getUint32(p)
  }
  return false
}

function exifOrientation(view: DataView, tiff: number): number {
  const little = ascii(view, tiff, 2) === 'II'
  const entries = tiff + view.getUint32(tiff + 4, little)
  const count = view.getUint16(entries, little)
  for (let i = 0; i < count; i++) {
    const entry = entries + 2 + i * 12
    if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little)
  }
  return 1
}

function jpegOrientation(view: DataView): number {
  let p = 2
  while (p + 4 <= view.byteLength && view.getUint8(p) === 0xff) {
    const marker = view.getUint8(p + 1)
    if (marker === 0xda) break // start of scan: metadata segments come before it
    const length = view.getUint16(p + 2)
    if (marker === 0xe1 && ascii(view, p + 4, 6) === 'Exif\0\0') return exifOrientation(view, p + 10)
    p += 2 + length
  }
  return 1
}

// The browser applies EXIF orientation when decoding but the API does not, so a rotated image
// has to go through the canvas to come out the same way up as the preview. Anything else the API
// cannot read as is (say, a WebP named .png) is also re-encoded.
export async function canSendOriginal(file: Blob): Promise<boolean> {
  const view = new DataView(await file.arrayBuffer())
  try {
    if (PNG_SIGNATURE.every((b, i) => view.getUint8(i) === b)) return !pngHasExif(view)
    if (view.getUint16(0) === 0xffd8) return jpegOrientation(view) === 1
  } catch (e) {
    // Metadata that points outside the file: let the canvas produce a clean copy.
    if (e instanceof RangeError) return false
    throw e
  }
  return false
}

// Lossless when it fits. A rotated, noisy photo may not, and rejecting it would be worse than
// slight JPEG loss.
export async function encodeForUpload(rgba: ArrayBuffer, width: number, height: number): Promise<Blob> {
  const png = await rgbaToPng(rgba, width, height)
  return png.size <= MAX_FILE_BYTES ? png : rgbaToJpeg(rgba, width, height)
}

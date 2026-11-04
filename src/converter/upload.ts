import { MAX_FILE_BYTES } from './limits.ts'
import { rgbaToJpeg, rgbaToPng } from './remote.ts'

// Decides what server mode uploads. The compressed image data of the original is preferred:
// re-encoding a large, noisy photo as PNG can exceed the upload limit, and as JPEG it would
// lose quality. Metadata (GPS position, capture time, camera, thumbnails, comments) never leaves
// the browser: only the parts needed to decode the image are copied, so anything unknown is
// dropped. Files this cannot handle safely return null and go through the canvas, which writes
// a new file without metadata.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_KEPT_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'])

function hasAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

function stripPng(bytes: Uint8Array<ArrayBuffer>): Blob | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const parts: Uint8Array<ArrayBuffer>[] = [bytes.subarray(0, PNG_SIGNATURE.length)]
  let p = PNG_SIGNATURE.length
  let sawData = false
  while (p + 12 <= bytes.length) {
    const end = p + 12 + view.getUint32(p)
    if (end > bytes.length) return null
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8))
    // Browsers may apply this orientation; the API would not.
    if (type === 'eXIf') return null
    if (type === 'IDAT') sawData = true
    if (PNG_KEPT_CHUNKS.has(type)) parts.push(bytes.subarray(p, end))
    if (type === 'IEND') return sawData ? new Blob(parts, { type: 'image/png' }) : null
    p = end
  }
  return null
}

// The Orientation tag of an Exif segment (offsets are relative to the segment, so a bad one
// raises RangeError). Returns null when it cannot be read reliably.
function exifOrientation(segment: Uint8Array<ArrayBuffer>): number | null {
  const tiff = new DataView(segment.buffer, segment.byteOffset + 6, segment.byteLength - 6)
  const order = tiff.getUint16(0)
  if (order !== 0x4949 && order !== 0x4d4d) return null
  const little = order === 0x4949
  if (tiff.getUint16(2, little) !== 42) return null
  const ifd = tiff.getUint32(4, little)
  const count = tiff.getUint16(ifd, little)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (tiff.getUint16(entry, little) !== 0x0112) continue
    // Must be a single SHORT, stored inline.
    if (tiff.getUint16(entry + 2, little) !== 3 || tiff.getUint32(entry + 4, little) !== 1) return null
    return tiff.getUint16(entry + 8, little)
  }
  return 1
}

// Where the entropy-coded data starting at `start` ends, or -1 if it runs off the file.
function endOfScan(bytes: Uint8Array, start: number): number {
  let i = start
  for (;;) {
    i = bytes.indexOf(0xff, i)
    if (i < 0 || i + 1 >= bytes.length) return -1
    const next = bytes[i + 1]
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) i += 2 // stuffed byte or restart marker
    else if (next === 0xff) i += 1 // fill byte
    else return i
  }
}

// JFIF only describes pixel density, but it may embed a thumbnail, which is dropped.
function jfifWithoutThumbnail(segment: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(18)
  out.set(segment.subarray(0, 16))
  out[3] = 16 // segment length
  out[2] = 0
  out[16] = 0
  out[17] = 0
  return out
}

function stripJpeg(bytes: Uint8Array<ArrayBuffer>): Blob | null {
  const parts: Uint8Array<ArrayBuffer>[] = [bytes.subarray(0, 2)]
  let p = 2
  let sawFrame = false
  let sawScan = false
  for (;;) {
    if (bytes[p] !== 0xff) return null
    while (bytes[p + 1] === 0xff) p++ // fill bytes may precede any marker
    const marker = bytes[p + 1]
    if (marker === undefined) return null
    if (marker === 0xd9) {
      if (!sawFrame || !sawScan) return null
      // Stopping here also drops what follows the image: extra pictures, gain maps, videos.
      parts.push(bytes.subarray(p, p + 2))
      return new Blob(parts, { type: 'image/jpeg' })
    }
    // A stuffed byte, restart marker, second SOI or TEM here means the walk has lost its place.
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) return null
    if (p + 4 > bytes.length) return null
    const length = (bytes[p + 2] << 8) | bytes[p + 3]
    const next = p + 2 + length
    if (length < 2 || next > bytes.length) return null
    const segment = bytes.subarray(p, next)
    const body = p + 4

    if (marker === 0xe1 && hasAscii(bytes, body, 'Exif')) {
      if (!hasAscii(bytes, body + 4, '\0\0')) return null
      if (exifOrientation(bytes.subarray(body, next)) !== 1) return null
    } else if (marker === 0xe0) {
      if (hasAscii(bytes, body, 'JFIF\0') && length >= 16) parts.push(jfifWithoutThumbnail(segment))
    } else if (marker === 0xee) {
      // Tells the decoder how color is stored; CMYK files decode wrongly without it.
      if (hasAscii(bytes, body, 'Adobe')) parts.push(segment)
    } else if (marker !== 0xfe && (marker < 0xe0 || marker > 0xef)) {
      parts.push(segment)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) sawFrame = true
    }

    if (marker === 0xda) {
      sawScan = true
      const end = endOfScan(bytes, next)
      if (end < 0) return null
      parts.push(bytes.subarray(next, end))
      p = end
    } else {
      p = next
    }
  }
}

// The file without metadata and with its image data untouched, or null if it has to be
// re-encoded: rotated by EXIF (the API does not apply orientation), damaged, or not PNG/JPEG
// inside (say, a WebP named .png).
export async function stripMetadata(file: Blob): Promise<Blob | null> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return stripPng(bytes)
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return stripJpeg(bytes)
  } catch (e) {
    if (e instanceof RangeError) return null
    throw e
  }
  return null
}

// Lossless when it fits. A rotated, noisy photo may not, and rejecting it would be worse than
// slight JPEG loss.
export async function encodeForUpload(rgba: ArrayBuffer, width: number, height: number): Promise<Blob> {
  const png = await rgbaToPng(rgba, width, height)
  return png.size <= MAX_FILE_BYTES ? png : rgbaToJpeg(rgba, width, height)
}

import { describe, expect, it } from 'vitest'
import { canSendOriginal } from './upload.ts'

const SOI = [0xff, 0xd8]
const SOS = [0xff, 0xda, 0x00, 0x02]

function u16(n: number, little: boolean) {
  return little ? [n & 255, n >> 8] : [n >> 8, n & 255]
}

function u32(n: number, little: boolean) {
  const b = [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  return little ? b.reverse() : b
}

function exifSegment(orientation: number, little: boolean) {
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42, little),
    ...u32(8, little),
    ...u16(1, little),
    ...u16(0x0112, little),
    ...u16(3, little),
    ...u32(1, little),
    ...u16(orientation, little),
    0,
    0,
    ...u32(0, little),
  ]
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  return [0xff, 0xe1, ...u16(body.length + 2, false), ...body]
}

const blob = (...parts: number[][]) => new Blob([new Uint8Array(parts.flat())])

function pngChunk(type: string, data: number[] = []) {
  return [...u32(data.length, false), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0]
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('canSendOriginal', () => {
  it('sends a JPEG without EXIF', async () => {
    await expect(canSendOriginal(blob(SOI, SOS))).resolves.toBe(true)
  })

  it.each([
    [1, true, true],
    [1, false, true],
    [6, true, false],
    [6, false, false],
    [3, false, false],
  ])('orientation %i (little-endian %s) -> %s', async (orientation, little, expected) => {
    await expect(canSendOriginal(blob(SOI, exifSegment(orientation, little), SOS))).resolves.toBe(expected)
  })

  it('finds EXIF after another segment', async () => {
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0, 0]
    await expect(canSendOriginal(blob(SOI, app0, exifSegment(6, true), SOS))).resolves.toBe(false)
  })

  it('sends a PNG unless it carries EXIF', async () => {
    const ihdr = pngChunk('IHDR', new Array(13).fill(0))
    await expect(canSendOriginal(blob(PNG, ihdr, pngChunk('IDAT', [1, 2]), pngChunk('IEND')))).resolves.toBe(true)
    await expect(
      canSendOriginal(blob(PNG, ihdr, pngChunk('IDAT', [1, 2]), pngChunk('eXIf', [1]), pngChunk('IEND'))),
    ).resolves.toBe(false)
  })

  it('re-encodes other formats and empty or malformed files', async () => {
    await expect(canSendOriginal(blob([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0, 0]))).resolves.toBe(false)
    await expect(canSendOriginal(blob([]))).resolves.toBe(false)
    const truncated = exifSegment(6, true).slice(0, 14)
    await expect(canSendOriginal(blob(SOI, truncated))).resolves.toBe(false)
  })
})

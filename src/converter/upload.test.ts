import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_FILE_BYTES } from './limits.ts'
import { rgbaToJpeg, rgbaToPng } from './remote.ts'
import { encodeForUpload, stripMetadata } from './upload.ts'

vi.mock('./remote.ts', () => ({ rgbaToPng: vi.fn(), rgbaToJpeg: vi.fn() }))

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

function u16(n: number, little = false) {
  return little ? [n & 255, n >> 8] : [n >> 8, n & 255]
}

function u32(n: number, little = false) {
  const b = [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  return little ? b.reverse() : b
}

const segment = (marker: number, body: number[]) => [0xff, marker, ...u16(body.length + 2), ...body]

function exif(orientation: number | null, little = true, extra: number[] = []) {
  const entries = orientation === null ? [] : [...u16(0x0112, little), ...u16(3, little), ...u32(1, little), ...u16(orientation, little), 0, 0]
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42, little),
    ...u32(8, little),
    ...u16(orientation === null ? 0 : 1, little),
    ...entries,
    ...u32(0, little),
    ...extra,
  ]
  return segment(0xe1, [...ascii('Exif\0\0'), ...tiff])
}

const SECRET = ascii('SECRET-GPS-35.6812N-Canon-2026:01:01')

const SOI = [0xff, 0xd8]
const EOI = [0xff, 0xd9]
const DQT = segment(0xdb, [0, 1, 2, 3])
const SOF = segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0])
const DHT = segment(0xc4, [0, 9, 9])
// Entropy data with a stuffed byte and a restart marker, which must not end the scan.
const SCAN = [...segment(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]
const IMAGE = [...DQT, ...SOF, ...DHT, ...SCAN]
const JPEG = [...SOI, ...IMAGE, ...EOI]

const blob = (...parts: number[][]) => new Blob([new Uint8Array(parts.flat())])
const bytesOf = async (b: Blob | null) => {
  expect(b).not.toBeNull()
  return [...new Uint8Array(await b!.arrayBuffer())]
}

function chunk(type: string, data: number[] = []) {
  return [...u32(data.length), ...ascii(type), ...data, 1, 2, 3, 4]
}

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const IHDR = chunk('IHDR', new Array(13).fill(7))
const IDAT = chunk('IDAT', [1, 2])
const IEND = chunk('IEND')

describe('stripMetadata: JPEG', () => {
  it('returns the image data unchanged when there is nothing to remove', async () => {
    expect(await bytesOf(await stripMetadata(blob(JPEG)))).toEqual(JPEG)
  })

  it('removes EXIF with GPS, time and camera data, and keeps the image data intact', async () => {
    const out = await stripMetadata(blob(SOI, exif(1, true, SECRET), IMAGE, EOI))
    expect(await bytesOf(out)).toEqual(JPEG)
  })

  it('removes a file with no Orientation tag the same way', async () => {
    expect(await bytesOf(await stripMetadata(blob(SOI, exif(null, true, SECRET), IMAGE, EOI)))).toEqual(JPEG)
  })

  it.each([
    ['XMP', 0xe1, ascii('http://ns.adobe.com/xap/1.0/\0')],
    ['ICC or MPF', 0xe2, ascii('ICC_PROFILE\0')],
    ['IPTC', 0xed, ascii('Photoshop 3.0\0')],
    ['maker notes', 0xeb, ascii('HDR_RI')],
    ['JFXX thumbnail', 0xe0, ascii('JFXX\0')],
    ['comment', 0xfe, []],
  ])('removes %s', async (_name, marker, prefix) => {
    const out = await stripMetadata(blob(SOI, segment(marker, [...prefix, ...SECRET]), IMAGE, EOI))
    expect(await bytesOf(out)).toEqual(JPEG)
  })

  it('removes what follows the image, such as a second picture or a video', async () => {
    expect(await bytesOf(await stripMetadata(blob(JPEG, SECRET)))).toEqual(JPEG)
  })

  it('removes metadata between the scans of a progressive file', async () => {
    const out = await stripMetadata(blob(SOI, DQT, SOF, DHT, SCAN, segment(0xfe, SECRET), DHT, SCAN, EOI))
    expect(await bytesOf(out)).toEqual([...SOI, ...DQT, ...SOF, ...DHT, ...SCAN, ...DHT, ...SCAN, ...EOI])
  })

  it('keeps the JFIF density and the Adobe color transform, without the JFIF thumbnail', async () => {
    const density = [...ascii('JFIF\0'), 1, 1, 1, 0, 72, 0, 72]
    const adobe = segment(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 2])
    const withThumb = segment(0xe0, [...density, 1, 1, 9, 9, 9])
    const out = await bytesOf(await stripMetadata(blob(SOI, withThumb, adobe, IMAGE, EOI)))
    expect(out).toEqual([...SOI, ...segment(0xe0, [...density, 0, 0]), ...adobe, ...IMAGE, ...EOI])
  })

  it('handles fill bytes before a marker', async () => {
    const out = await stripMetadata(blob(SOI, [0xff, 0xff], exif(1), [0xff], IMAGE, EOI))
    expect(await bytesOf(out)).toEqual(JPEG)
  })

  it('sees the orientation behind fill bytes', async () => {
    await expect(stripMetadata(blob(SOI, [0xff, 0xff], exif(6), IMAGE, EOI))).resolves.toBeNull()
  })

  it('handles fill bytes inside the scan', async () => {
    const scan = [...SCAN, 0xff, 0xff, 0x00]
    const out = await stripMetadata(blob(SOI, DQT, SOF, DHT, scan, EOI))
    expect(await bytesOf(out)).toEqual([...SOI, ...DQT, ...SOF, ...DHT, ...scan, ...EOI])
  })

  it.each([2, 3, 4, 5, 6, 7, 8])('re-encodes orientation %i', async (orientation) => {
    await expect(stripMetadata(blob(SOI, exif(orientation), IMAGE, EOI))).resolves.toBeNull()
    await expect(stripMetadata(blob(SOI, exif(orientation, false), IMAGE, EOI))).resolves.toBeNull()
  })

  it('sees the orientation after an XMP segment', async () => {
    const xmp = segment(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0'))
    await expect(stripMetadata(blob(SOI, xmp, exif(6), IMAGE, EOI))).resolves.toBeNull()
  })

  it('reads a big-endian Orientation of 1 as no rotation', async () => {
    expect(await bytesOf(await stripMetadata(blob(SOI, exif(1, false), IMAGE, EOI)))).toEqual(JPEG)
  })

  it.each<[string, number[]]>([
    ['a truncated EXIF segment', [...SOI, ...exif(6).slice(0, 14)]],
    ['EXIF with a bad byte order', [...SOI, ...segment(0xe1, [...ascii('Exif\0\0'), 0x41, 0x41, 0, 42, 0, 0, 0, 8]), ...IMAGE, ...EOI]],
    ['EXIF with a bad TIFF magic', [...SOI, ...segment(0xe1, [...ascii('Exif\0\0'), 0x49, 0x49, 41, 0, 8, 0, 0, 0]), ...IMAGE, ...EOI]],
    ['an EXIF directory outside the segment', [...SOI, ...segment(0xe1, [...ascii('Exif\0\0'), 0x49, 0x49, 42, 0, 0xff, 0xff, 0, 0]), ...IMAGE, ...EOI]],
    ['a malformed EXIF header', [...SOI, ...segment(0xe1, [...ascii('Exif\0\x01'), 0x49, 0x49, 42, 0, 8, 0, 0, 0]), ...IMAGE, ...EOI]],
    ['an Orientation of the wrong type', [...SOI, ...segment(0xe1, [...ascii('Exif\0\0'), 0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 4, 0, 1, 0, 0, 0, 1, 0, 0, 0]), ...IMAGE, ...EOI]],
    ['a walk that lost its place', [...SOI, 0, 0, 0, 0, 0]],
    ['a stray restart marker', [...SOI, 0xff, 0xd0, ...IMAGE, ...EOI]],
    ['a segment longer than the file', [...SOI, 0xff, 0xdb, 0xff, 0xff, 0]],
    ['a segment with a bad length', [...SOI, 0xff, 0xdb, 0, 1, ...IMAGE, ...EOI]],
    ['a missing end of image', [...SOI, ...IMAGE]],
    ['a scan without a frame', [...SOI, ...SCAN, ...EOI]],
    ['only the start of a file', SOI],
  ])('re-encodes %s', async (_name, file) => {
    await expect(stripMetadata(blob(file))).resolves.toBeNull()
  })
})

describe('stripMetadata: PNG', () => {
  it('keeps what decoding needs and removes text and time chunks', async () => {
    const trns = chunk('tRNS', [0])
    const plte = chunk('PLTE', [1, 2, 3])
    const out = await stripMetadata(
      blob(SIG, IHDR, chunk('tEXt', SECRET), plte, trns, chunk('tIME', SECRET), IDAT, IDAT, chunk('iTXt', SECRET), IEND, SECRET),
    )
    expect(await bytesOf(out)).toEqual([...SIG, ...IHDR, ...plte, ...trns, ...IDAT, ...IDAT, ...IEND])
  })

  it('re-encodes a file with EXIF, wherever the chunk is', async () => {
    await expect(stripMetadata(blob(SIG, IHDR, chunk('eXIf', SECRET), IDAT, IEND))).resolves.toBeNull()
    await expect(stripMetadata(blob(SIG, IHDR, IDAT, chunk('eXIf', SECRET), IEND))).resolves.toBeNull()
  })

  it('re-encodes damaged files', async () => {
    await expect(stripMetadata(blob(SIG, IHDR, IDAT))).resolves.toBeNull()
    await expect(stripMetadata(blob(SIG, IHDR, IEND))).resolves.toBeNull()
    await expect(stripMetadata(blob(SIG, [0, 0, 0xff, 0xff], ascii('IDAT'), [1, 2, 3, 4]))).resolves.toBeNull()
  })
})

describe('stripMetadata: other input', () => {
  it('re-encodes other formats and empty files', async () => {
    await expect(stripMetadata(blob(ascii('RIFF\0\0\0\0WEBP')))).resolves.toBeNull()
    await expect(stripMetadata(blob([]))).resolves.toBeNull()
  })
})

describe('encodeForUpload', () => {
  const sized = (n: number, type: string) => new Blob([new Uint8Array(n)], { type })
  const rgba = new ArrayBuffer(4)

  afterEach(() => vi.resetAllMocks())

  it('uses PNG up to the upload limit', async () => {
    const png = sized(MAX_FILE_BYTES, 'image/png')
    vi.mocked(rgbaToPng).mockResolvedValue(png)

    await expect(encodeForUpload(rgba, 1, 1)).resolves.toBe(png)
    expect(rgbaToJpeg).not.toHaveBeenCalled()
  })

  it('switches to JPEG when the PNG would exceed it', async () => {
    const jpeg = sized(10, 'image/jpeg')
    vi.mocked(rgbaToPng).mockResolvedValue(sized(MAX_FILE_BYTES + 1, 'image/png'))
    vi.mocked(rgbaToJpeg).mockResolvedValue(jpeg)

    await expect(encodeForUpload(rgba, 1, 1)).resolves.toBe(jpeg)
    expect(rgbaToJpeg).toHaveBeenCalledWith(rgba, 1, 1)
  })
})

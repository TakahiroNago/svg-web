// Color counts accepted by the C++ engine (kAllowedColors in converter.cpp).
export const COLOR_OPTIONS = [2, 3, 4, 5, 6, 8, 12, 16, 24, 32] as const
export const DEFAULT_COLORS = 8

export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_SIDE = 4096
export const MAX_PIXELS = 4_000_000

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg']

export function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return 'PNG または JPEG ファイルを選択してください。'
  }
  if (file.size > MAX_FILE_BYTES) {
    return `ファイルサイズが大きすぎます(上限 ${MAX_FILE_BYTES / 1024 / 1024} MB)。`
  }
  return null
}

export function validateDimensions(width: number, height: number): string | null {
  if (width <= 0 || height <= 0) return '画像のサイズが不正です。'
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    return `画像が大きすぎます(${width}×${height})。1辺 ${MAX_SIDE}px 以下、合計 ${MAX_PIXELS.toLocaleString()} 画素以下にしてください。`
  }
  return null
}

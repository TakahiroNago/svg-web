import { fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

// jsdom has no Blob URLs; the app only passes them to <img>.
export function stubObjectUrls() {
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`)
  URL.revokeObjectURL = vi.fn()
}

export function selectImage(name = 'logo.png', type = 'image/png') {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('file input not found')
  const file = new File([new Uint8Array([137, 80, 78, 71])], name, { type })
  fireEvent.change(input, { target: { files: [file] } })
}

// Largest area first, as both engines return it. Index 2 has no pixels.
export const palette = [
  { index: 1, hex: '#ff0000', area: 10 },
  { index: 0, hex: '#0000ff', area: 6 },
  { index: 2, hex: '#00ff00', area: 0 },
]

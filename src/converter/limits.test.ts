import { describe, expect, it } from 'vitest'
import { MAX_PIXELS, validateDimensions } from './limits.ts'

describe('validateDimensions', () => {
  it('accepts exactly 9,000,000 pixels', () => {
    expect(MAX_PIXELS).toBe(9_000_000)
    expect(validateDimensions(3000, 3000)).toBeNull()
  })

  it('rejects one row more, and a side over the limit', () => {
    expect(validateDimensions(3001, 3000)).toContain('大きすぎます')
    expect(validateDimensions(4097, 1)).toContain('大きすぎます')
  })
})

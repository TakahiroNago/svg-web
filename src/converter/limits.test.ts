import { describe, expect, it } from 'vitest'
import { fitWithinLimits, MAX_PIXELS, MAX_SIDE, validateDimensions } from './limits.ts'

describe('validateDimensions', () => {
  it('accepts exactly 4,000,000 pixels', () => {
    expect(MAX_PIXELS).toBe(4_000_000)
    expect(validateDimensions(2000, 2000)).toBeNull()
  })

  it('rejects one row more, and a side over the limit', () => {
    expect(validateDimensions(2001, 2000)).toContain('大きすぎます')
    expect(validateDimensions(4097, 1)).toContain('大きすぎます')
  })
})

describe('fitWithinLimits', () => {
  it.each([
    [1, 1],
    [2000, 2000],
    [4000, 1000],
    [4096, 976],
  ])('leaves %i×%i alone', (width, height) => {
    expect(fitWithinLimits(width, height)).toEqual({ width, height })
  })

  it.each([
    [2001, 2000],
    [3000, 3000],
    [6000, 4000],
    [4000, 6000],
    [12000, 9000],
    [16384, 16384],
    [4097, 1],
    [1, 100000],
    [100000, 3],
    [4097, 1000],
  ])('reduces %i×%i to within the limits', (width, height) => {
    const fit = fitWithinLimits(width, height)
    expect(validateDimensions(fit.width, fit.height)).toBeNull()
    expect(fit.width).toBeLessThanOrEqual(width)
    expect(fit.height).toBeLessThanOrEqual(height)
    expect(fit.width * fit.height).toBeLessThan(width * height)
  })

  it('keeps the proportions and uses nearly all of the allowance', () => {
    expect(fitWithinLimits(3000, 3000)).toEqual({ width: 2000, height: 2000 })
    const fit = fitWithinLimits(6000, 4000)
    expect(Math.abs(fit.width / fit.height - 1.5)).toBeLessThan(0.001)
    expect(fit.width * fit.height).toBeGreaterThan(MAX_PIXELS * 0.99)
  })

  it('applies the side limit when it is the tighter one', () => {
    const fit = fitWithinLimits(8192, 100)
    expect(fit.width).toBe(MAX_SIDE)
    expect(fit.height).toBe(50)
  })
})

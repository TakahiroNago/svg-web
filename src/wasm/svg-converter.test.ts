// @vitest-environment node
// Runs the WASM module committed in src/wasm (the one Cloudflare Pages ships) in Node.
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import createSvgConverterModule, { type SvgConverterModule } from './svg-converter.js'

const wasmPath = fileURLToPath(new URL('./svg-converter.wasm', import.meta.url))

let mod: SvgConverterModule

beforeAll(async () => {
  mod = await createSvgConverterModule({ locateFile: (path) => (path.endsWith('.wasm') ? wasmPath : path) })
})

// Left half red, right half blue.
function twoColorImage(w = 8, h = 4) {
  const rgba = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    rgba.set(i % w < w / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4)
  }
  return { rgba, w, h }
}

describe('WASM converter', () => {
  it('analyzes and generates an SVG in a session, as the Web Worker does', () => {
    const { rgba, w, h } = twoColorImage()
    const session = new mod.SvgSession()
    try {
      const analyzed = session.analyze(rgba, w, h, 2)
      expect(analyzed.success, analyzed.error).toBe(true)
      expect(analyzed.palette.map((c) => c.hex.toLowerCase()).sort()).toEqual(['#0000ff', '#ff0000'])

      const kept = analyzed.palette.filter((c) => c.area > 0).map((c) => c.index)
      const result = session.generate(kept, false)
      expect(result.success, result.error).toBe(true)
      expect(result.svg).toMatch(/^<\?xml[\s\S]*<svg[\s\S]*<\/svg>/)
      expect(result.svg).toMatch(/#ff0000/i)
      expect(result.svg).toMatch(/#0000ff/i)
      expect(result.contourCount).toBeGreaterThan(0)
    } finally {
      session.delete()
    }
  })

  it('keeping every non-zero color matches the default selection used by the API', () => {
    const { rgba, w, h } = twoColorImage()
    const session = new mod.SvgSession()
    try {
      const analyzed = session.analyze(rgba, w, h, 2)
      const kept = analyzed.palette.filter((c) => c.area > 0).map((c) => c.index)
      const explicit = mod.convertImage(rgba, w, h, 2, kept, true)
      const implicit = mod.convertImage(rgba, w, h, 2, [], true)
      expect(explicit.success && implicit.success).toBe(true)
      expect(explicit.svg).toBe(implicit.svg)
    } finally {
      session.delete()
    }
  })
})

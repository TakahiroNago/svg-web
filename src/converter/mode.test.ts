import { describe, expect, it } from 'vitest'
import { ConverterConfigError, resolveConverterConfig } from './mode.ts'

describe('resolveConverterConfig', () => {
  it('defaults to wasm when nothing is set (Cloudflare Pages)', () => {
    expect(resolveConverterConfig({})).toEqual({ mode: 'wasm', apiBaseUrl: '' })
    expect(resolveConverterConfig({ VITE_CONVERTER_MODE: '', VITE_API_BASE_URL: '' })).toEqual({
      mode: 'wasm',
      apiBaseUrl: '',
    })
  })

  it('accepts explicit modes', () => {
    expect(resolveConverterConfig({ VITE_CONVERTER_MODE: 'wasm' }).mode).toBe('wasm')
    expect(resolveConverterConfig({ VITE_CONVERTER_MODE: 'server' }).mode).toBe('server')
  })

  it('uses the same origin in server mode when the API URL is empty (AWS)', () => {
    expect(resolveConverterConfig({ VITE_CONVERTER_MODE: 'server', VITE_API_BASE_URL: '' })).toEqual({
      mode: 'server',
      apiBaseUrl: '',
    })
  })

  it('accepts an absolute API origin in server mode and strips trailing slashes', () => {
    expect(
      resolveConverterConfig({ VITE_CONVERTER_MODE: 'server', VITE_API_BASE_URL: 'http://localhost:8080/' }),
    ).toEqual({ mode: 'server', apiBaseUrl: 'http://localhost:8080' })
  })

  it.each(['Server', 'api', 'remote', 'true'])('rejects the unknown mode %s', (value) => {
    expect(() => resolveConverterConfig({ VITE_CONVERTER_MODE: value })).toThrow(ConverterConfigError)
  })

  it('rejects an API URL in wasm mode instead of ignoring it', () => {
    expect(() => resolveConverterConfig({ VITE_API_BASE_URL: 'http://localhost:8080' })).toThrow(
      /only used when VITE_CONVERTER_MODE=server/,
    )
    expect(() =>
      resolveConverterConfig({ VITE_CONVERTER_MODE: 'wasm', VITE_API_BASE_URL: 'https://example.com' }),
    ).toThrow(ConverterConfigError)
  })

  it.each(['/api', 'localhost:8080', 'ftp://example.com', 'https://example.com/api', 'https://example.com/api/'])(
    'rejects the API URL %s',
    (value) => {
      expect(() => resolveConverterConfig({ VITE_CONVERTER_MODE: 'server', VITE_API_BASE_URL: value })).toThrow(
        ConverterConfigError,
      )
    },
  )
})

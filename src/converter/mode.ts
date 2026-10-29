// Converter mode settings. Shared by the app and vite.config.ts, so it must not read import.meta.env.
//
//   wasm   (default) convert in the browser with WebAssembly; images never leave the browser
//   server           send images to the Go REST API (/api/v1/convert), which calls the C++ engine over gRPC

export type ConverterMode = 'wasm' | 'server'

export type ConverterConfig = {
  mode: ConverterMode
  /** Origin of the Go API without a trailing slash. Empty means the same origin as the page. */
  apiBaseUrl: string
}

export class ConverterConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConverterConfigError'
  }
}

export function resolveConverterConfig(env: {
  VITE_CONVERTER_MODE?: string
  VITE_API_BASE_URL?: string
}): ConverterConfig {
  const rawMode = (env.VITE_CONVERTER_MODE ?? '').trim()
  const apiBaseUrl = (env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')

  if (rawMode !== '' && rawMode !== 'wasm' && rawMode !== 'server') {
    throw new ConverterConfigError(
      `VITE_CONVERTER_MODE must be "wasm" or "server" (got "${env.VITE_CONVERTER_MODE}").`,
    )
  }
  const mode: ConverterMode = rawMode === 'server' ? 'server' : 'wasm'

  if (mode === 'wasm' && apiBaseUrl !== '') {
    // Before VITE_CONVERTER_MODE existed, setting the URL alone enabled server mode.
    // Refuse instead of silently ignoring it, so a WASM build never looks like a server build.
    throw new ConverterConfigError(
      'VITE_API_BASE_URL is only used when VITE_CONVERTER_MODE=server. ' +
        'Set VITE_CONVERTER_MODE=server, or leave VITE_API_BASE_URL empty for WASM mode.',
    )
  }

  if (apiBaseUrl !== '') {
    let url: URL
    try {
      url = new URL(apiBaseUrl)
    } catch {
      throw new ConverterConfigError(`VITE_API_BASE_URL must be an absolute http(s) URL (got "${apiBaseUrl}").`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ConverterConfigError(`VITE_API_BASE_URL must use http or https (got "${apiBaseUrl}").`)
    }
    if (/\/api$/.test(url.pathname.replace(/\/+$/, ''))) {
      // Requests go to `${apiBaseUrl}/api/v1/convert`, so a trailing /api would double it.
      throw new ConverterConfigError(`VITE_API_BASE_URL must not end with /api (got "${apiBaseUrl}").`)
    }
  }

  return { mode, apiBaseUrl }
}

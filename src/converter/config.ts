import { resolveConverterConfig } from './mode.ts'

// vite.config.ts validates the same settings at build time; this throws at startup if it was bypassed.
const config = resolveConverterConfig({
  VITE_CONVERTER_MODE: import.meta.env.VITE_CONVERTER_MODE,
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
})

export const CONVERTER_MODE = config.mode
export const API_BASE_URL = config.apiBaseUrl

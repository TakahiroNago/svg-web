/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { resolveConverterConfig } from './src/converter/mode.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Fail the build and the dev server on an invalid converter setting instead of
  // silently using another mode. loadEnv also reads VITE_* variables from process.env.
  // Vitest skips this: the tests mock the mode and must not depend on a local .env.
  const converter = process.env.VITEST
    ? resolveConverterConfig({})
    : resolveConverterConfig(loadEnv(mode, process.cwd(), 'VITE_'))

  return {
    plugins: [
      react(),
      {
        // Lets the deploy check confirm which mode the published build uses.
        name: 'converter-mode-meta',
        transformIndexHtml: () => [
          { tag: 'meta', attrs: { name: 'converter-mode', content: converter.mode }, injectTo: 'head' },
        ],
      },
    ],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})

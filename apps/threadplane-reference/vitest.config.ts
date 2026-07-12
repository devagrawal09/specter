import { defineConfig } from 'vitest/config'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solidPlugin({ ssr: true })],
  resolve: {
    conditions: ['development', 'browser'],
  },
  test: {
    environment: 'jsdom',
  },
})

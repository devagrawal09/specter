import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  base: '/specter/',
  server: {
    port: 41733,
    strictPort: true,
  },
  preview: {
    port: 41733,
    strictPort: true,
  },
  plugins: [solidPlugin()],
})

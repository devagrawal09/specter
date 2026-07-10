import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
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

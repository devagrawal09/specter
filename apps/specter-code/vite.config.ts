import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

import { tanstackStart } from '@tanstack/solid-start/plugin/vite'

import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    port: 41734,
    strictPort: true,
  },
  preview: {
    port: 41734,
    strictPort: true,
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
      },
    }),
    solidPlugin({ ssr: true }),
  ],
})

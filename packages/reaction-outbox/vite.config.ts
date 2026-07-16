import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: { index: './src/index.ts' },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^@specter-ts\/core(?:\/.*)?$/, /^node:/],
    },
  },
})

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: { index: './src/index.ts', cli: './src/cli.ts' },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^node:/],
    },
  },
})

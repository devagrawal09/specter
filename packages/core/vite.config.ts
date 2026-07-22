import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        index: './src/index.ts',
        testing: './src/testing-entry.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        /^@effect\//,
        /^effect(\/.*)?$/,
        /^@specter-ts\/spec$/,
        /^node:/,
        'vitest',
      ],
    },
  },
})

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: { index: './src/index.ts', testing: './src/testing.ts' },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        /^@specter-ts\/core(?:\/.*)?$/,
        /^effect(?:\/.*)?$/,
        /^node:/,
        'vitest',
      ],
    },
  },
})

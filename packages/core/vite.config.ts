import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        index: './src/index.ts',
        spec: './src/spec-entry.ts',
        testing: './src/testing-entry.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^@effect\//, /^effect(\/.*)?$/, /^node:/, 'vitest'],
    },
  },
})

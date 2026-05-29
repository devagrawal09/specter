import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        client: './src/client-entry.ts',
        index: './src/index.ts',
        testing: './src/testing-entry.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^@effect\//, /^effect(\/.*)?$/, /^node:/, 'vitest'],
    },
  },
})

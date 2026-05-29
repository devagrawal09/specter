import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        client: './src/client-entry.ts',
        index: './src/index.ts',
        schema: './src/schema-entry.ts',
        testing: './src/testing-entry.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        /^@effect\//,
        /^drizzle-orm(\/.*)?$/,
        /^effect(\/.*)?$/,
        /^node:/,
        'better-sqlite3',
        'vitest',
      ],
    },
  },
})

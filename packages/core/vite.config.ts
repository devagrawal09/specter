import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        client: './src/client-entry.ts',
        index: './src/index.ts',
        schema: './src/schema-entry.ts',
        testing: './src/testing-entry.ts',
        view: './src/view-entry.ts',
        vite: './src/vite.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        /^@effect\//,
        /^@solidjs\//,
        /^drizzle-orm(\/.*)?$/,
        /^effect(\/.*)?$/,
        /^node:/,
        /^solid-js(\/.*)?$/,
        'better-sqlite3',
        'vite',
        'vitest',
      ],
    },
  },
  plugins: [solidPlugin()],
})

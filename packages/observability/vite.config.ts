import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: { index: './src/index.ts', cli: './src/cli.ts' },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        /^@specter-ts\/core(?:\/.*)?$/,
        /^@specter-ts\/memory(?:\/.*)?$/,
        /^@specter-ts\/protocol(?:\/.*)?$/,
        /^@specter-ts\/reaction-outbox(?:\/.*)?$/,
        /^@specter-ts\/sqlite(?:\/.*)?$/,
        /^@libsql\/client(?:\/.*)?$/,
        /^node:/,
      ],
    },
  },
})

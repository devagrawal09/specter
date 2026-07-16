import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@specter-ts/reaction-outbox': fileURLToPath(
        new URL('../reaction-outbox/src/index.ts', import.meta.url),
      ),
    },
  },
})

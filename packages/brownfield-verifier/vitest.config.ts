import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@specter-ts/core/spec',
        replacement: fileURLToPath(
          new URL('../core/src/spec-entry.ts', import.meta.url),
        ),
      },
      {
        find: '@specter-ts/core',
        replacement: fileURLToPath(
          new URL('../core/src/index.ts', import.meta.url),
        ),
      },
    ],
  },
})

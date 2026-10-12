import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const outbox = (file: string) =>
  fileURLToPath(new URL(`../reaction-outbox/src/${file}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@specter-ts\/reaction-outbox$/, replacement: outbox('index.ts') },
      {
        find: /^@specter-ts\/reaction-outbox\/testing$/,
        replacement: outbox('testing.ts'),
      },
    ],
  },
})

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  use: { baseURL: 'http://127.0.0.1:41738' },
  webServer: {
    command: 'node tests/e2e/fake-provider-server.mjs',
    url: 'http://127.0.0.1:41738',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

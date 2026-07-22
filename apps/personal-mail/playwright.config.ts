import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  use: { baseURL: 'http://127.0.0.1:41738' },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:41738',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './src/browser',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:41732',
    launchOptions: { executablePath: process.env.SPECTER_CHROMIUM_PATH },
  },
  webServer: {
    command: 'node --import tsx src/browser/server.ts',
    url: 'http://127.0.0.1:41732',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})

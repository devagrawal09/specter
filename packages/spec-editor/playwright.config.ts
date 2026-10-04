import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './browser',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:41739',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})

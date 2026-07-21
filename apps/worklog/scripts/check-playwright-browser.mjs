import { chromium } from '@playwright/test'
import { existsSync } from 'node:fs'

const executablePath = chromium.executablePath()

if (!existsSync(executablePath)) {
  throw new Error(
    [
      'Playwright Chromium is not installed for this project.',
      'Run: npm run test:e2e:install',
      `Expected executable: ${executablePath}`,
    ].join('\n'),
  )
}

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test, type TestInfo } from '@playwright/test'

import {
  listSpecterCodeSessionsOnServer,
  listSpecterCodeWorkspacesOnServer,
} from '../../src/features/specter-code/server-runtime.server'

const configPath = path.join(process.cwd(), '.opencode', 'opencode.jsonc')
let previousConfig: string | undefined

async function readOptionalConfig() {
  try {
    return await readFile(configPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function uniqueLabel(label: string, testInfo: TestInfo) {
  return `${label} ${Date.now()}-${testInfo.workerIndex}`
}

test.beforeEach(async () => {
  previousConfig = await readOptionalConfig()
  await rm(configPath, { force: true })
})

async function openSettings(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Open model and agent settings' }).click()
  return page.getByRole('region', { name: 'Model and agent settings' })
}

test.afterEach(async () => {
  if (previousConfig === undefined) {
    await rm(configPath, { force: true })
    return
  }
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, previousConfig, 'utf8')
})

test('shows OpenCode model and agent settings from the live registries', async ({ page }) => {
  await page.goto('/')

  const settings = await openSettings(page)
  await expect(settings).toBeVisible({ timeout: 10_000 })

  await expect(settings.getByText('Default model')).toBeVisible()
  await expect(settings.getByText('openrouter/anthropic/claude-sonnet-4')).toBeVisible()
  await expect(settings).toContainText('OpenRouter')
  await expect(settings.getByText('missing key')).toBeVisible()

  await expect(settings.getByText('Default agent')).toBeVisible()
  await expect(settings.getByLabel('Default agent')).toHaveValue('build')
  await expect(settings).toContainText('Build')
  await expect(settings.getByText('read, grep, shell')).toBeVisible()
})

test('saves editable default model and agent controls and uses them for new sessions', async ({
  page,
}, testInfo) => {
  const workspaceName = uniqueLabel('Settings Workspace', testInfo)
  const sessionTitle = uniqueLabel('settings session', testInfo)

  await page.goto('/')

  const settings = await openSettings(page)
  await expect(settings).toBeVisible({ timeout: 10_000 })
  await settings.getByLabel('Default model').selectOption('openai/gpt-5.1')
  await settings.getByLabel('Default agent').selectOption('plan')
  await settings.getByRole('button', { name: 'Save model and agent settings' }).click()

  await expect(settings.getByText('Saved plan with openai/gpt-5.1')).toBeVisible()
  await expect(settings.getByLabel('Default model')).toHaveValue('openai/gpt-5.1')
  await expect(settings.getByLabel('Default agent')).toHaveValue('plan')
  await expect(settings).toContainText('Plan')
  await expect(settings.getByText('glob, grep, read')).toBeVisible()

  await page.getByPlaceholder('Workspace name').fill(workspaceName)
  await page.getByRole('button', { name: 'Create Workspace' }).click()
  await expect(page.getByRole('button', { name: workspaceName })).toBeVisible()
  await page.getByPlaceholder('New session title').fill(sessionTitle)
  await page.getByRole('button', { name: 'Create', exact: true }).click()

  const workspace = (await listSpecterCodeWorkspacesOnServer()).find(
    (item) => item.name === workspaceName,
  )
  expect(workspace).toBeTruthy()
  await expect
    .poll(async () => {
      const sessions = await listSpecterCodeSessionsOnServer({ workspaceId: workspace!.id })
      return sessions.find((item) => item.title === sessionTitle)
    })
    .toEqual(
      expect.objectContaining({
        agent: 'plan',
        model: { providerId: 'openai', modelId: 'gpt-5.1' },
      }),
    )
})

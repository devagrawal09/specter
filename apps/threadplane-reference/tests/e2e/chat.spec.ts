import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import {
  listThreadplaneWorkspaceChatOnServer,
  listThreadplaneWorkspacesOnServer,
} from '../../src/features/threadplane/server-runtime.server'

function uniqueLabel(label: string, testInfo: TestInfo) {
  return `${label} ${Date.now()}-${testInfo.workerIndex}`
}

async function openThreadplane(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/')

    try {
      await expect(page.getByPlaceholder('Workspace name')).toBeVisible({
        timeout: 10_000,
      })
      return
    } catch (cause) {
      if (attempt === 2) throw cause
    }
  }
}

test('loads the reference shell', async ({ page }) => {
  await openThreadplane(page)

  await expect(page.getByRole('heading', { name: 'Reference UI' })).toBeVisible()
  await expect(page.getByPlaceholder('Workspace name')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Simulate run' })).toBeVisible()
})

test('creates a workspace, posts, scans, previews a file, and shows a simulated run', async ({
  page,
}, testInfo) => {
  const workspaceName = uniqueLabel('E2E Workspace', testInfo)
  const message = uniqueLabel('e2e post', testInfo)
  const fileContents = uniqueLabel('preview file', testInfo)

  await openThreadplane(page)
  await page.getByPlaceholder('Workspace name').fill(workspaceName)
  await page.getByRole('button', { name: 'Create Workspace' }).click()

  await expect(page.getByRole('heading', { name: workspaceName })).toBeVisible()

  const workspace = (await listThreadplaneWorkspacesOnServer()).find(
    (item) => item.name === workspaceName,
  )
  expect(workspace).toBeTruthy()

  const workspaceRoot = path.join(
    process.cwd(),
    'data',
    'threadplane-workspaces',
    workspace!.id,
  )
  await mkdir(workspaceRoot, { recursive: true })
  await writeFile(path.join(workspaceRoot, 'notes.txt'), `${fileContents}\n`)

  await page.getByPlaceholder('Write a post...').fill(message)
  await page.getByRole('button', { name: 'Post' }).click()
  await expect(page.getByText(message, { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Scan' }).click()
  await expect(page.getByText('Latest')).toBeVisible()
  await expect(page.getByRole('button', { name: /📄 notes\.txt/ })).toBeVisible()

  await page.getByRole('button', { name: /📄 notes\.txt/ }).click()
  await expect(page.getByText(fileContents, { exact: false })).toBeVisible()

  await page.getByRole('button', { name: 'Simulate run' }).click()
  await expect(
    page.getByRole('button', { name: /Simulated Agent · (completed|failed|running|pending)/ }),
  ).toBeVisible()
  await expect(page.getByText('I found the issue.', { exact: false })).toBeVisible()

  const chat = await listThreadplaneWorkspaceChatOnServer({ workspaceId: workspace!.id })
  expect(chat.some((item) => item.author.type === 'agent')).toBeTruthy()
})

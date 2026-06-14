import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import {
  listThreadplaneWorkspaceChatOnServer,
  listThreadplaneWorkspacesOnServer,
} from '../../src/features/threadplane/server-runtime.server'

const artifactRoot = '/tmp/opencode/threadplane-reference-demo'

test.use({ video: 'on' })

test('records the Threadplane Reference common workflow demo', async ({ page }) => {
  const workspaceName = `Demo Workspace ${Date.now()}`
  const message = 'Please inspect the seeded demo workspace.'
  const fileContents = `Threadplane demo notes\n\n- seeded for the reusable Playwright demo\n- safe to delete after recording\n`

  await mkdir(artifactRoot, { recursive: true })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Reference UI' })).toBeVisible()
  await page.screenshot({
    path: path.join(artifactRoot, '01-loaded-threadplane-reference.png'),
    fullPage: true,
  })

  await page.getByPlaceholder('Workspace name').fill(workspaceName)
  await page.getByRole('button', { name: 'Create Workspace' }).click()
  await expect(page.getByRole('button', { name: workspaceName })).toBeVisible()
  await page.getByRole('button', { name: workspaceName }).click()
  await expect(page.getByRole('heading', { name: workspaceName })).toBeVisible()
  await page.screenshot({
    path: path.join(artifactRoot, '02-created-selected-workspace.png'),
    fullPage: true,
  })

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
  await writeFile(path.join(workspaceRoot, 'demo-notes.txt'), fileContents)

  await page.getByPlaceholder('Write a post...').fill(message)
  await page.getByRole('button', { name: 'Post' }).click()
  await expect(page.getByText(message, { exact: true })).toBeVisible()
  await page.screenshot({
    path: path.join(artifactRoot, '03-posted-message.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: 'Scan' }).click()
  await expect(page.getByText('Latest')).toBeVisible()
  await expect(page.getByRole('button', { name: /📄 demo-notes\.txt/ })).toBeVisible()
  await page.screenshot({
    path: path.join(artifactRoot, '04-filesystem-scan-tree.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: /📄 demo-notes\.txt/ }).click()
  await expect(page.getByText('Threadplane demo notes', { exact: false })).toBeVisible()
  await page.screenshot({
    path: path.join(artifactRoot, '05-preview-text-file.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: 'Simulate run' }).click()
  const runButton = page.getByRole('button', {
    name: /Simulated Agent · (completed|failed|running|pending)/,
  })
  await expect(runButton).toBeVisible()
  await runButton.click()
  await expect(page.getByText(/inspectWorkspace|readFile|searchFiles/)).toBeVisible()
  await page.screenshot({
    path: path.join(artifactRoot, '06-agent-run-tool-calls.png'),
    fullPage: true,
  })

  await expect
    .poll(async () => {
      const chat = await listThreadplaneWorkspaceChatOnServer({
        workspaceId: workspace!.id,
      })
      return chat.find(
        (item) => item.author.type === 'agent' && Boolean(item.sourceRunId),
      )?.content
    })
    .toBeTruthy()
  const chat = await listThreadplaneWorkspaceChatOnServer({
    workspaceId: workspace!.id,
  })
  const agentReply = chat.find(
    (item) => item.author.type === 'agent' && Boolean(item.sourceRunId),
  )?.content
  expect(agentReply).toBeTruthy()
  await expect(page.getByText(String(agentReply), { exact: false })).toBeVisible()
  await page.screenshot({
    path: path.join(artifactRoot, '07-final-agent-reply.png'),
    fullPage: true,
  })

  const video = page.video()
  await page.close()
  await video?.saveAs(path.join(artifactRoot, 'threadplane-reference-demo.webm'))
})

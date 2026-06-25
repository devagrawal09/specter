import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import {
  listSpecterCodeSessionTranscriptOnServer,
  listSpecterCodeSessionsOnServer,
  listSpecterCodeWorkspacesOnServer,
} from '../../src/features/specter-code/server-runtime.server'

const artifactRoot = '/tmp/opencode/specter-code-demo'

test.use({ video: 'on' })

test('records the SpecterCode session chat workflow demo', async ({ page }) => {
  const workspaceName = `Demo Workspace ${Date.now()}`
  const sessionTitle = 'Inspect seeded demo workspace'
  const prompt = 'Please inspect the seeded demo workspace.'
  const fileContents = `SpecterCode demo notes\n\n- seeded for the reusable Playwright demo\n- safe to delete after recording\n`

  await mkdir(artifactRoot, { recursive: true })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Specter Code Chat' })).toBeVisible()
  await page.screenshot({
    path: path.join(artifactRoot, '01-loaded-specter-code.png'),
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

  const workspace = (await listSpecterCodeWorkspacesOnServer()).find(
    (item) => item.name === workspaceName,
  )
  expect(workspace).toBeTruthy()

  const workspaceRoot = path.join(
    process.cwd(),
    'data',
    'specter-code-workspaces',
    workspace!.id,
  )
  await mkdir(workspaceRoot, { recursive: true })
  await writeFile(path.join(workspaceRoot, 'demo-notes.txt'), fileContents)

  await page.getByPlaceholder('New session title').fill(sessionTitle)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('button', { name: new RegExp(sessionTitle) })).toBeVisible()
  const session = (await listSpecterCodeSessionsOnServer({ workspaceId: workspace!.id })).find(
    (item) => item.title === sessionTitle,
  )
  expect(session).toBeTruthy()

  await page.getByPlaceholder('Prompt this session').fill(prompt)
  await page.getByRole('button', { name: 'Send' }).click()
  const transcriptLog = page.getByRole('log', { name: 'Session transcript' })
  await expect(transcriptLog.getByText(prompt, { exact: false })).toBeVisible()
  const pendingApprovals = page.getByRole('region', { name: 'Pending approvals' })
  const allowPromptTool = pendingApprovals.getByRole('button', { name: /Allow / }).first()
  await expect(allowPromptTool).toBeVisible()
  await allowPromptTool.click()
  await expect
    .poll(async () => listSpecterCodeSessionTranscriptOnServer({ sessionId: session!.id }))
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: prompt }),
        expect.objectContaining({ role: 'assistant' }),
      ]),
    )
  await page.screenshot({
    path: path.join(artifactRoot, '03-session-transcript-prompt.png'),
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
  await expect(page.getByText('SpecterCode demo notes', { exact: false })).toBeVisible()
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
  await expect(
    page.getByText(/^(inspectWorkspace|readFile|searchFiles)$/).first(),
  ).toBeVisible()
  await page.screenshot({
    path: path.join(artifactRoot, '06-agent-run-tool-calls.png'),
    fullPage: true,
  })

  const transcript = await listSpecterCodeSessionTranscriptOnServer({
    sessionId: session!.id,
  })
  const agentReply = transcript.find((item) => item.role === 'assistant')?.content
  expect(agentReply).toBeTruthy()
  await expect(transcriptLog.getByText(String(agentReply), { exact: false })).toBeVisible()
  await page.screenshot({
    path: path.join(artifactRoot, '07-final-agent-reply.png'),
    fullPage: true,
  })

  const video = page.video()
  await page.close()
  await video?.saveAs(path.join(artifactRoot, 'specter-code-demo.webm'))
})

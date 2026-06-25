import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import {
  listSpecterCodeSessionTranscriptOnServer,
  listSpecterCodeSessionsOnServer,
  listSpecterCodeWorkspaceChatOnServer,
  listSpecterCodeWorkspacesOnServer,
} from '../../src/features/specter-code/server-runtime.server'

function uniqueLabel(label: string, testInfo: TestInfo) {
  return `${label} ${Date.now()}-${testInfo.workerIndex}`
}

async function openSpecterCode(page: Page) {
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

test('loads the OpenCode-style session chat shell', async ({ page }) => {
  await openSpecterCode(page)

  await expect(page.getByRole('heading', { name: 'Specter Code Chat' })).toBeVisible()
  await expect(page.getByPlaceholder('Workspace name')).toBeVisible()
  await expect(page.getByPlaceholder('Prompt this session')).toBeVisible()
  await expect(page.getByRole('log', { name: 'Session transcript' })).toBeVisible()
  await expect(page.getByPlaceholder('Write a post...')).toHaveCount(0)
})

test('creates a workspace, prompts a session, scans, previews a file, and shows a simulated run', async ({
  page,
}, testInfo) => {
  const workspaceName = uniqueLabel('E2E Workspace', testInfo)
  const sessionTitle = uniqueLabel('e2e session', testInfo)
  const prompt = uniqueLabel('e2e prompt', testInfo)
  const fileContents = uniqueLabel('preview file', testInfo)

  await openSpecterCode(page)
  await page.getByPlaceholder('Workspace name').fill(workspaceName)
  await page.getByRole('button', { name: 'Create Workspace' }).click()

  await expect(page.getByRole('button', { name: workspaceName })).toBeVisible()
  await page.getByRole('button', { name: workspaceName }).click()
  await expect(page.getByRole('heading', { name: workspaceName })).toBeVisible()

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
  await writeFile(path.join(workspaceRoot, 'notes.txt'), `${fileContents}\n`)
  await writeFile(path.join(workspaceRoot, 'binary.bin'), new Uint8Array([0, 1, 2]))


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
    .poll(async () => {
      return listSpecterCodeSessionTranscriptOnServer({ sessionId: session!.id })
    })
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: prompt }),
        expect.objectContaining({ role: 'assistant' }),
      ]),
    )
  const promptTranscript = await listSpecterCodeSessionTranscriptOnServer({
    sessionId: session!.id,
  })
  const promptAssistantReply = promptTranscript.find((item) => item.role === 'assistant')
  expect(promptAssistantReply).toBeTruthy()
  await expect(
    page.getByText(promptAssistantReply?.content ?? '', { exact: false }).first(),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Scan' }).click()
  await expect(page.getByText('Latest')).toBeVisible()
  await expect(page.getByRole('button', { name: /📄 notes\.txt/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /📄 binary\.bin/ })).toBeVisible()

  await page.getByRole('button', { name: /📄 notes\.txt/ }).click()
  await expect(page.getByText(fileContents, { exact: false })).toBeVisible()

  await page.getByRole('button', { name: /📄 binary\.bin/ }).click()
  await expect(page.getByText('Preview unavailable')).toBeVisible()
  await expect(page.getByText('Preview file appears to be binary')).toBeVisible()

  await page.getByRole('button', { name: 'Simulate run' }).click()
  await expect(
    page.getByRole('button', { name: /Simulated Agent · (completed|failed|running|pending)/ }),
  ).toBeVisible()
  await expect
    .poll(async () => {
      const chat = await listSpecterCodeWorkspaceChatOnServer({
        workspaceId: workspace!.id,
      })
      return chat.find(
        (item) => item.author.type === 'agent' && Boolean(item.sourceRunId),
      )
    })
    .toBeTruthy()
  const chat = await listSpecterCodeWorkspaceChatOnServer({
    workspaceId: workspace!.id,
  })
  const visibleAgentReply = chat.find(
    (item) => item.author.type === 'agent' && Boolean(item.sourceRunId),
  )
  expect(visibleAgentReply).toBeTruthy()
  expect(visibleAgentReply?.parentPostId).toBeTruthy()
  await expect(
    page.getByText(visibleAgentReply?.content ?? '', { exact: false }).first(),
  ).toBeVisible()
})

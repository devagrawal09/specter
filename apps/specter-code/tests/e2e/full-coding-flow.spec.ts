import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import {
  createSpecterCodeSessionOnServer,
  createSpecterCodeWorkspaceOnServer,
  listSpecterCodeSessionTranscriptOnServer,
  listSpecterCodeSessionsOnServer,
  listSpecterCodeWorkspacesOnServer,
  submitSpecterCodePromptOnServer,
} from '../../src/features/specter-code/server-runtime.server'

const execFileAsync = promisify(execFile)

function uniqueLabel(label: string, testInfo: TestInfo) {
  return `${label} ${Date.now()}-${testInfo.workerIndex}`
}

async function openSpecterCode(page: Page) {
  await page.goto('/')
  await expect(page.getByPlaceholder('Workspace name')).toBeVisible({ timeout: 10_000 })
}

async function createWorkspaceFixture(testInfo: TestInfo) {
  const workspaceName = uniqueLabel('Full Flow Workspace', testInfo)
  await createSpecterCodeWorkspaceOnServer({ name: workspaceName })
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
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
  await writeFile(path.join(workspaceRoot, 'src', 'answer.ts'), 'export const answer = 41\n')
  await execFileAsync('git', ['init'], { cwd: workspaceRoot })
  await execFileAsync('git', ['add', 'src/answer.ts'], { cwd: workspaceRoot })
  await execFileAsync(
    'git',
    [
      '-c',
      'user.email=specter@example.test',
      '-c',
      'user.name=Specter Test',
      'commit',
      '-m',
      'initial answer',
    ],
    { cwd: workspaceRoot },
  )

  return { workspace: workspace!, workspaceName, workspaceRoot }
}

test('runs an approval-gated coding flow and reverts changed workspace files', async ({
  page,
}, testInfo) => {
  const { workspace, workspaceName, workspaceRoot } = await createWorkspaceFixture(testInfo)
  const sessionTitle = uniqueLabel('full coding flow', testInfo)
  const sessionId = `full-flow-session-${Date.now()}-${testInfo.workerIndex}`
  const messageId = `full-flow-message-${Date.now()}-${testInfo.workerIndex}`
  const runId = `full-flow-shell-run-${Date.now()}-${testInfo.workerIndex}`
  const prompt = 'add a passing test and run it'

  await createSpecterCodeSessionOnServer({
    sessionId,
    workspaceId: workspace.id,
    title: sessionTitle,
    directory: '.',
    agent: 'build',
    model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
    createdBy: { displayName: 'SpecterCode User' },
  })
  await submitSpecterCodePromptOnServer({
    messageId,
    runId,
    sessionId,
    workspaceId: workspace.id,
    content: prompt,
    agentId: 'build',
    agentName: 'Build Agent',
    submittedBy: { displayName: 'SpecterCode User' },
  })

  await openSpecterCode(page)
  await page.getByRole('button', { name: workspaceName }).click()
  await page.getByRole('button', { name: new RegExp(sessionTitle) }).click()

  const approvals = page.getByRole('region', { name: 'Pending approvals' })
  await expect(approvals.getByText('shell · shell.execute')).toBeVisible()
  await approvals.getByRole('button', { name: /Allow / }).first().click()

  await expect
    .poll(async () => listSpecterCodeSessionTranscriptOnServer({ sessionId }))
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: prompt }),
        expect.objectContaining({ role: 'assistant' }),
      ]),
    )
  await expect(page.getByRole('region', { name: 'Agent timeline' }).getByText('shell', { exact: true })).toBeVisible()
  await expect(page.getByText('Simulated shell output')).toBeVisible()

  await writeFile(path.join(workspaceRoot, 'src', 'answer.ts'), 'export const answer = 42\n')

  const diffPanel = page.getByRole('region', { name: 'Workspace diff' })
  await diffPanel.getByRole('button', { name: 'Refresh diff' }).click()
  await expect(diffPanel.getByText('src/answer.ts', { exact: true })).toBeVisible()
  await expect(diffPanel.getByText('+export const answer = 42')).toBeVisible()

  await diffPanel.getByRole('button', { name: 'Revert changed files' }).click()
  await expect.poll(async () => readFile(path.join(workspaceRoot, 'src', 'answer.ts'), 'utf8')).toBe(
    'export const answer = 41\n',
  )
  await diffPanel.getByRole('button', { name: 'Refresh diff' }).click()
  await expect(diffPanel.getByText('No workspace changes')).toBeVisible()

  const sessions = await listSpecterCodeSessionsOnServer({ workspaceId: workspace.id })
  expect(sessions).toEqual(expect.arrayContaining([expect.objectContaining({ id: sessionId })]))
})

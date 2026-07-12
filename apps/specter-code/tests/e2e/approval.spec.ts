import { expect, test, type Page, type TestInfo } from '@playwright/test'

import {
  createSpecterCodeSessionOnServer,
  createSpecterCodeWorkspaceOnServer,
  listSpecterCodePendingPermissionsOnServer,
  listSpecterCodeSessionsOnServer,
  listSpecterCodeWorkspacesOnServer,
  requestSpecterCodeToolApprovalOnServer,
} from '../../src/features/specter-code/server-runtime.server'

function uniqueLabel(label: string, testInfo: TestInfo) {
  return `${label} ${Date.now()}-${testInfo.workerIndex}`
}

async function openSpecterCode(page: Page) {
  await page.goto('/')
  await expect(page.getByPlaceholder('Workspace name')).toBeVisible({ timeout: 10_000 })
}

test('shows pending tool approval requests and records user decisions', async ({ page }, testInfo) => {
  const workspaceName = uniqueLabel('Approval Workspace', testInfo)
  const sessionTitle = uniqueLabel('approval session', testInfo)

  await createSpecterCodeWorkspaceOnServer({ name: workspaceName })
  const workspace = (await listSpecterCodeWorkspacesOnServer()).find(
    (item) => item.name === workspaceName,
  )
  expect(workspace).toBeTruthy()

  await createSpecterCodeSessionOnServer({
    sessionId: `approval-session-${Date.now()}-${testInfo.workerIndex}`,
    workspaceId: workspace!.id,
    title: sessionTitle,
    directory: '.',
    agent: 'build',
    model: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4' },
    createdBy: { displayName: 'SpecterCode User' },
  })
  const session = (await listSpecterCodeSessionsOnServer({ workspaceId: workspace!.id })).find(
    (item) => item.title === sessionTitle,
  )
  expect(session).toBeTruthy()

  await requestSpecterCodeToolApprovalOnServer({
    requestId: `approval-request-${Date.now()}-${testInfo.workerIndex}`,
    sessionId: session!.id,
    messageId: 'approval-message-1',
    workspaceId: workspace!.id,
    agentId: 'build',
    toolCallId: 'approval-tool-call-1',
    toolName: 'shell',
    permission: 'shell.execute',
    target: 'pnpm test',
    reason: 'E2E approval request',
  })

  await openSpecterCode(page)
  await page.getByRole('button', { name: workspaceName }).click()
  await page.getByRole('button', { name: new RegExp(sessionTitle) }).click()

  const approvals = page.getByRole('region', { name: 'Pending approvals' })
  await expect(approvals.getByText('pnpm test')).toBeVisible()
  await approvals.getByRole('button', { name: /Allow shell\.execute/ }).click()

  await expect(approvals.getByText('pnpm test')).toHaveCount(0)
  await expect
    .poll(async () => listSpecterCodePendingPermissionsOnServer({ sessionId: session!.id }))
    .toEqual([])
})

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'

const executeFile = promisify(execFile)
const apiUrl = 'http://127.0.0.1:41736/api'
const appDirectory = new URL('../..', import.meta.url).pathname
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

test('keeps subscriptions live and preserves rejected connection input', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible()
  await expect(page.getByText('Your timeline is quiet.')).toBeVisible()

  const cliTask = 'CLI subscription task'
  await runCli('command', {
    type: 'addTask',
    payload: {
      taskId: 'e2e-cli-task',
      title: cliTask,
      notes: null,
      dueAt: null,
      createdAt: '2026-07-18T22:00:00.000Z',
    },
  })
  await expect(page.getByText(cliTask, { exact: true })).toBeVisible()

  const responseLossTitle = 'Committed before response loss'
  let droppedCommittedResponse = false
  await page.route('**/api/command', async (route) => {
    const body = route.request().postDataJSON() as {
      envelope?: { type?: string; payload?: { title?: string } }
    }
    if (
      !droppedCommittedResponse &&
      body.envelope?.type === 'addTask' &&
      body.envelope.payload?.title === responseLossTitle
    ) {
      droppedCommittedResponse = true
      await route.fetch()
      await route.abort('failed')
      return
    }
    await route.continue()
  })

  const taskTitle = page.getByLabel('Task title')
  await taskTitle.fill(responseLossTitle)
  const addTaskButton = page
    .locator('form.quick-card')
    .filter({ hasText: 'New task' })
    .getByRole('button', { name: 'Add' })
  await addTaskButton.click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(taskTitle).toHaveValue(responseLossTitle)
  await addTaskButton.click()
  await expect(taskTitle).toHaveValue('')
  await page.unroute('**/api/command')

  const tasksAfterRetry = await runCli('query', {
    type: 'tasksQuery',
    payload: { status: 'all', topicId: null },
  })
  expect(
    tasksAfterRetry.result.filter(
      (task: { title: string }) => task.title === responseLossTitle,
    ),
  ).toHaveLength(1)

  const archiveTitle = 'Archive through the UI'
  await page.getByLabel('Task title').fill(archiveTitle)
  await page
    .locator('form.quick-card')
    .filter({ hasText: 'New task' })
    .getByRole('button', { name: 'Add' })
    .click()
  await page.getByRole('button', { name: 'tasks', exact: true }).click()

  const archiveRow = page.locator('article.task-row').filter({ hasText: archiveTitle })
  await expect(archiveRow).toBeVisible()
  await archiveRow.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(archiveRow).toHaveCount(0)

  await page.getByRole('button', { name: 'timeline', exact: true }).click()
  const topicName = 'Connection topic'
  await page.getByLabel('Topic name').fill(topicName)
  await page
    .locator('form.quick-card')
    .filter({ hasText: 'New topic' })
    .getByRole('button', { name: 'Add' })
    .click()
  await page.getByRole('button', { name: 'tasks', exact: true }).click()

  const firstRecord = page.getByLabel('First record')
  const secondRecord = page.getByLabel('Second record')
  const taskValue = 'task:e2e-cli-task'
  const topicValue = await secondRecord
    .locator('option', { hasText: `Topic · ${topicName}` })
    .getAttribute('value')
  expect(topicValue).toBeTruthy()

  await firstRecord.selectOption(taskValue)
  await secondRecord.selectOption(topicValue as string)
  await page.getByRole('button', { name: 'Connect records' }).click()
  await expect(firstRecord).toHaveValue('')
  await expect(secondRecord).toHaveValue('')

  await firstRecord.selectOption(taskValue)
  await secondRecord.selectOption(topicValue as string)
  await page.getByRole('button', { name: 'Connect records' }).click()
  await expect(page.getByRole('alert')).toContainText('Records are already connected')
  await expect(firstRecord).toHaveValue(taskValue)
  await expect(secondRecord).toHaveValue(topicValue as string)

  await page.reload()
  await expect(page.getByText(cliTask, { exact: true })).toBeVisible()
  const journalBody = 'Appears after subscription reconnect'
  await runCli('command', {
    type: 'addJournalEntry',
    payload: {
      journalEntryId: 'e2e-reconnect-journal',
      body: journalBody,
      activityAt: '2026-07-18T22:30:00.000Z',
      createdAt: '2026-07-18T22:30:00.000Z',
    },
  })
  await expect(page.getByText(journalBody, { exact: true })).toBeVisible()

  const score = await runCli('query', {
    type: 'scoreQuery',
    payload: { limit: 100 },
  })
  expect(score).toMatchObject({ ok: true, transport: 'http' })
  expect(score.result.total).toBeGreaterThan(0)
})

async function runCli(mode: 'command' | 'query', envelope: unknown) {
  const { stdout } = await executeFile(
    pnpmCommand,
    [
      'worklog',
      '--',
      mode,
      '--url',
      apiUrl,
      '--json',
      JSON.stringify(envelope),
    ],
    { cwd: appDirectory },
  )
  const jsonLine = stdout
    .trim()
    .split('\n')
    .reverse()
    .find((line) => line.trim().startsWith('{'))
  if (!jsonLine) throw new Error(`CLI did not return JSON:\n${stdout}`)
  return JSON.parse(jsonLine) as {
    ok: boolean
    transport: string
    result: any
  }
}

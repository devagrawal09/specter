import { expect, test } from '@playwright/test'

test('creates, publishes and connects a document, discussion and task', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Specter Workspaces')
  await expect(
    page.getByText('◈ Specter Workspaces', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('#connection')).toContainText('Live')
  page.once('dialog', (dialog) => {
    void dialog.accept('Launch plan')
  })
  await page.getByRole('button', { name: '+ New document' }).click()
  await expect(
    page.getByRole('heading', { name: 'Launch plan', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Session draft').fill('Publish the launch plan')
  await expect(page.locator('#draft-status')).toHaveText('Session draft saved.')
  await page.getByRole('button', { name: 'Publish revision' }).click()
  await expect(page.locator('#status')).toHaveText(
    'Published document revision.',
  )
  await page.getByLabel('New message').fill('Please review')
  await page.getByRole('button', { name: 'Post message' }).click()
  await expect(page.locator('#messages')).toContainText('Please review')
  await page.getByRole('button', { name: 'Create linked task' }).click()
  await expect(page.locator('#tasks')).toContainText('Follow up: Please review')
  await page.getByRole('button', { name: '○ Open', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '✓ Done', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Append demo' }).click()
  await expect(page.locator('#messages')).toContainText(
    'Please review · thinking · done',
  )
  await page.reload()
  await expect(page.getByLabel('Session draft')).toHaveValue(
    'Publish the launch plan',
  )
  await expect(page.locator('#messages')).toContainText(
    'Please review · thinking · done',
  )
  await page.screenshot({
    path: testInfo.outputPath('specter-workspaces.png'),
    fullPage: true,
  })
})

test('rejects stale focused text across real tabs and recovers after explicit reload', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await expect(page.locator('#connection')).toContainText('Live')
  page.once('dialog', (dialog) => {
    void dialog.accept('Shared plan')
  })
  await page.getByRole('button', { name: '+ New document' }).click()
  await expect(
    page.getByRole('heading', { name: 'Shared plan', exact: true }),
  ).toBeVisible()
  const second = await context.newPage()
  await second.goto('/')
  await expect(second.getByLabel('Session draft')).toBeEnabled()
  await second.getByLabel('Session draft').focus()
  await page.getByLabel('Session draft').fill('Published by the other tab')
  await expect(page.locator('#draft-status')).toHaveText('Session draft saved.')
  await page.getByRole('button', { name: 'Publish revision' }).click()
  await expect(page.locator('#status')).toHaveText(
    'Published document revision.',
  )
  await expect(second.locator('#revision')).toContainText(
    'Published revision 2',
  )
  await expect(second.getByLabel('Session draft')).toBeFocused()
  await expect(second.getByLabel('Session draft')).toHaveValue('')
  await second
    .getByLabel('Session draft')
    .fill('Stale text with another keystroke')
  await expect(second.locator('#status')).toContainText(
    'View revision conflict',
  )
  await expect(second.getByLabel('Session draft')).toHaveValue(
    'Stale text with another keystroke',
  )
  await expect(
    second.getByRole('button', { name: 'Publish revision' }),
  ).toBeDisabled()
  const response = await page.request.get('/api/workspace')
  const state = await response.json()
  const shared = Object.values(state.documents).find(
    (value) => (value as { title: string }).title === 'Shared plan',
  )
  expect(shared).toMatchObject({
    body: 'Published by the other tab',
    revision: 2,
  })
  await second.getByRole('button', { name: 'Shared plan', exact: true }).click()
  await expect(second.getByLabel('Session draft')).toHaveValue(
    'Published by the other tab',
  )
  await second
    .getByLabel('Session draft')
    .fill('Explicitly reloaded and edited')
  await expect(second.locator('#draft-status')).toHaveText(
    'Session draft saved.',
  )
  await second.getByRole('button', { name: 'Publish revision' }).click()
  await expect(second.locator('#status')).toHaveText(
    'Published document revision.',
  )
  await expect(second.locator('#revision')).toContainText(
    'Published revision 3',
  )
})

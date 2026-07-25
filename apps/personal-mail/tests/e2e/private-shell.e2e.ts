import { expect, test } from '@playwright/test'

test('renders the private inbox and protects state-changing routes', async ({
  page,
  request,
}) => {
  const untrustedPost = await request.post('/api/sync')
  expect(untrustedPost.status()).toBe(403)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Personal Mail' })).toBeVisible()
  await expect(page.getByText('owner@example.com')).toBeVisible()
  await expect(page.getByText('Local AI is the default.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect Gmail' })).toBeHidden()
  await expect(page.getByText('No failed deliveries.')).toBeVisible()

  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(
    page.getByText('Imported 1 changed threads; scheduled 0 authorized actions.'),
  ).toBeVisible()
  const thread = page.locator('.thread').filter({
    hasText: 'Provider integration review',
  })
  await expect(thread).toBeVisible()
  await expect
    .poll(async () => {
      const response = await request.get('/api/inbox')
      const inbox = (await response.json()) as Array<{
        analysis: null | { summary: string }
      }>
      return inbox[0]?.analysis?.summary
    })
    .toBe('Fake provider marked this message for review.')
  await page.reload()
  await expect(
    thread.getByText('Fake provider marked this message for review.'),
  ).toBeVisible()
  await expect(thread.getByText('local · high')).toBeVisible()
  await expect(
    page.getByText('local: Fake provider marked this message for review.'),
  ).toBeVisible()

  const ruleName = `Archive review fixture ${Date.now()}`
  await page.getByPlaceholder('Rule name').fill(ruleName)
  await page.getByPlaceholder('Sender contains').fill('fixture@example.com')
  await page.getByRole('button', { name: 'Grant rule' }).click()
  await expect(
    page.getByText('Automation authority granted and evaluated against the inbox.'),
  ).toBeVisible()

  const rule = page.locator('.rule').filter({ hasText: ruleName })
  await expect(rule.getByText('Enabled · archive')).toBeVisible()
  await rule.getByRole('button', { name: 'Disable' }).click()
  await expect(
    page.getByText('Automation authority revoked for this rule.'),
  ).toBeVisible()
  await expect(rule.getByText('Disabled · archive')).toBeVisible()
  await expect(rule.getByRole('button', { name: 'Enable' })).toBeVisible()

  await thread.getByRole('button', { name: 'Archive' }).click()
  await expect(
    page.getByText(
      'archive requested; Gmail confirmation will appear in the audit trail.',
    ),
  ).toBeVisible()
  await expect
    .poll(async () => {
      const response = await request.get('/api/inbox')
      return ((await response.json()) as unknown[]).length
    })
    .toBe(0)
  await page.reload()
  await expect(thread).toBeHidden()
  await expect(page.getByText(/archive: Gmail history 102/)).toBeVisible()
  await expect(page.getByText('No failed deliveries.')).toBeVisible()
})

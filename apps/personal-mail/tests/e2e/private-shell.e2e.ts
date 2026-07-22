import { expect, test } from '@playwright/test'

test('renders the private inbox and protects state-changing routes', async ({
  page,
  request,
}) => {
  const untrustedPost = await request.post('/api/sync')
  expect(untrustedPost.status()).toBe(403)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Personal Mail' })).toBeVisible()
  await expect(page.getByText('Gmail not connected')).toBeVisible()
  await expect(page.getByText('Local AI is the default.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect Gmail' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeDisabled()

  await page.getByPlaceholder('Rule name').fill('Archive review fixture')
  await page.getByPlaceholder('Sender contains').fill('fixture@example.com')
  await page.getByRole('button', { name: 'Grant rule' }).click()
  await expect(
    page.getByText('Automation authority granted and evaluated against the inbox.'),
  ).toBeVisible()
})

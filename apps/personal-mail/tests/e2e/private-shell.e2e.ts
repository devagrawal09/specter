import { expect, test } from '@playwright/test'

test('renders the disconnected private inbox without exposing cloud as a default', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Personal Mail' })).toBeVisible()
  await expect(page.getByText('Gmail not connected')).toBeVisible()
  await expect(page.getByText('Local AI is the default.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect Gmail' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeDisabled()
})

import { expect, test } from '@playwright/test'

test('shows OpenCode model and agent settings from the live registries', async ({ page }) => {
  await page.goto('/')

  const settings = page.getByRole('region', { name: 'Model and agent settings' })
  await expect(settings).toBeVisible({ timeout: 10_000 })

  await expect(settings.getByText('Default model')).toBeVisible()
  await expect(settings.getByText('openrouter/anthropic/claude-sonnet-4')).toBeVisible()
  await expect(settings).toContainText('OpenRouter')
  await expect(settings.getByText('missing key')).toBeVisible()

  await expect(settings.getByText('Default agent')).toBeVisible()
  await expect(settings.getByText('Build', { exact: true })).toBeVisible()
  await expect(settings.getByText('read, grep, shell')).toBeVisible()
})

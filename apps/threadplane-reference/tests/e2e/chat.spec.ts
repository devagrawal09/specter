import { expect, test, type Page, type TestInfo } from '@playwright/test'

function uniqueMessage(label: string, testInfo: TestInfo) {
  return `${label} ${Date.now()}-${testInfo.workerIndex}`
}

async function openThreadplane(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/')

    try {
      await expect(page.getByPlaceholder('Write a message...')).toBeVisible({
        timeout: 10_000,
      })
      return
    } catch (cause) {
      if (attempt === 2) throw cause
    }
  }
}

test('loads the Threadplane workspace chat shell', async ({ page }) => {
  await openThreadplane(page)

  await expect(page.locator('aside').getByText(/^threadplane$/i)).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Workspace Chat' }),
  ).toBeVisible()
  await expect(page.getByPlaceholder('Write a message...')).toBeVisible()
})

test('sends a normal chat message', async ({ page }, testInfo) => {
  const message = uniqueMessage('e2e normal message', testInfo)

  await openThreadplane(page)
  await page.getByPlaceholder('Write a message...').fill(message)
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByText(message, { exact: true })).toBeVisible()
})

test('sends a Specter mention and shows the deterministic reply', async ({
  page,
}, testInfo) => {
  const message = uniqueMessage('e2e @specter mention', testInfo)

  await openThreadplane(page)
  await page.getByPlaceholder('Write a message...').fill(message)
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByText(message, { exact: true })).toBeVisible()
  await expect(
    page.getByText(`Specter heard: ${message}`, { exact: true }),
  ).toBeVisible()
})

test('creates and selects a workspace with scoped Specter replies', async ({
  page,
}, testInfo) => {
  const workspaceName = uniqueMessage('E2E Workspace', testInfo)
  const message = uniqueMessage('workspace scoped @specter mention', testInfo)

  await openThreadplane(page)
  await page.getByPlaceholder('Workspace name').fill(workspaceName)
  await page.getByRole('button', { name: 'Create Workspace' }).click()

  await expect(
    page.getByRole('heading', { name: workspaceName }),
  ).toBeVisible()

  await page.getByPlaceholder('Write a message...').fill(message)
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByText(message, { exact: true })).toBeVisible()
  await expect(
    page.getByText(`Specter heard: ${message}`, { exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Main Workspace' }).click()
  await expect(
    page.getByRole('heading', { name: 'Main Workspace' }),
  ).toBeVisible()
  await expect(page.getByText(message, { exact: true })).not.toBeVisible()
})

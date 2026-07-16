import { expect, test } from '@playwright/test'

test('creates, completes, filters, and removes a todo', async ({ page }) => {
  const title = `Generated project ${Date.now()}`

  await page.goto('/')
  await page.getByPlaceholder('Add a todo').fill(title)
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  const todo = page.getByText(title, { exact: true })
  await expect(todo).toBeVisible()

  const completed = todo.locator('..').getByRole('checkbox')
  await completed.click()
  await expect(completed).toBeChecked()
  await page.getByRole('button', { name: 'Active', exact: true }).click()
  await expect(todo).toBeHidden()

  await page.getByRole('button', { name: 'Completed', exact: true }).click()
  await expect(todo).toBeVisible()

  await todo.locator('..').getByRole('button', { name: 'Remove' }).click()
  await expect(todo).toBeHidden()
})

import { expect, test as base } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startSpecEditor } from '../dist/index.js'

const specification = (name = 'addTodo') => ({
  $schema: 'https://specter.dev/specification/v1/slice.schema.json',
  formatVersion: 1,
  kind: 'command',
  name,
  description: 'Adds a todo.',
  scenarios: [
    {
      description: 'Adds one.',
      given: [],
      when: { title: 'Ship it' },
      expect: [
        {
          kind: 'scenario-event',
          eventType: 'todo-added',
          examplePayload: { title: 'Ship it' },
        },
      ],
    },
  ],
})

const test = base.extend<{ project: { editable: string } }>({
  project: async ({ page }, use) => {
    const root = await mkdtemp(join(tmpdir(), 'specter-editor-'))
    const editableDir = join(root, 'src/features/todos/add')
    const generatedDir = join(root, 'src/features/todos/generated')
    const editable = join(editableDir, 'spec.json')
    await mkdir(editableDir, { recursive: true })
    await mkdir(generatedDir, { recursive: true })
    await writeFile(editable, JSON.stringify(specification(), null, 2) + '\n')
    await writeFile(
      join(generatedDir, 'spec.json'),
      JSON.stringify(specification('generatedTodo'), null, 2) + '\n',
    )
    await writeFile(join(generatedDir, 'spec.ts'), 'export default {}\n')
    const server = await startSpecEditor(root, { usePolling: true })
    try {
      await page.goto(server.url)
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
        'addTodo',
      )
      await use({ editable })
    } finally {
      for (const openPage of page.context().pages()) await openPage.close()
      await server.close()
      await rm(root, { recursive: true, force: true })
    }
  },
})

test.beforeEach(async ({ project }) => void project)

test('typing remains focused and saving persists a new digest', async ({
  page,
  project,
}) => {
  const name = page.getByLabel('Name', { exact: true })
  await name.click()
  await name.pressSequentially('Changed')
  await expect(name).toBeFocused()
  const digest = await page.locator('.digest').textContent()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
  expect(JSON.parse(await readFile(project.editable, 'utf8')).name).toBe(
    'addTodoChanged',
  )
  await page.reload()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'addTodoChanged',
  )
  await expect(page.locator('.digest')).not.toHaveText(digest!)
})

test('event name keeps focus while typing several characters', async ({
  page,
}) => {
  const input = page.getByLabel('Event name')
  await input.click()
  await input.pressSequentially('-v2')
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('todo-added-v2')
})

test('invalid JSON blocks save and repaired JSON saves', async ({ page }) => {
  const editor = page.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText('{')
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText('{"title":"Repaired"}')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
})

test('adds, reorders, removes, and rejects scenarios', async ({
  page,
  project,
}) => {
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page
    .locator('.detail-column')
    .getByLabel('Description', { exact: true })
    .fill('Rejected duplicate')
  await page.getByLabel('Move scenario up').nth(1).click()
  await expect(page.locator('.scenario-select strong').first()).toHaveText(
    'Rejected duplicate',
  )
  await page.locator('.stage-title select').selectOption('rejected')
  await page
    .getByLabel('Exact rejection reason')
    .fill('A todo with that title already exists')
  await expect(page.getByLabel('Exact rejection reason')).toHaveValue(
    'A todo with that title already exists',
  )
  await page.getByLabel('Remove scenario').nth(1).click()
  await expect(page.locator('.scenario-select')).toHaveCount(1)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
  const saved = JSON.parse(await readFile(project.editable, 'utf8'))
  expect(saved.scenarios[0].reject).toEqual({
    reason: 'A todo with that title already exists',
  })
  expect(saved.scenarios[0].expect).toEqual([])
})

for (const kind of ['command', 'query', 'reaction'] as const) {
  test('creates, saves, and removes a ' + kind, async ({ page }) => {
    await page.getByRole('button', { name: 'Add Slice' }).click()
    await page.getByLabel(/Path/).fill('todos/' + kind)
    await page
      .getByLabel('Slice name', { exact: true })
      .fill('new' + kind[0].toUpperCase() + kind.slice(1))
    await page.getByLabel(/Kind/).selectOption(kind)
    await page.getByRole('button', { name: 'Create draft' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Save', exact: true }),
    ).toBeDisabled()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
  })
}

test('discard can be canceled or accepted and generated files are read only', async ({
  page,
}) => {
  await page.getByLabel('Name', { exact: true }).fill('unsavedName')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByText('generatedTodo', { exact: true }).click()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'unsavedName',
  )
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByText('generatedTodo', { exact: true }).click()
  await expect(page.getByLabel('Name', { exact: true })).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
})

test('filesystem watch refreshes clean state and reports dirty conflicts', async ({
  page,
  project,
}) => {
  await writeFile(
    project.editable,
    JSON.stringify(specification('diskName'), null, 2) + '\n',
  )
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('diskName')
  await page.getByLabel('Name', { exact: true }).fill('dirtyName')
  await writeFile(
    project.editable,
    JSON.stringify(specification('diskAgain'), null, 2) + '\n',
  )
  await expect(
    page.getByText('Disk changed. Reload before saving.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Reload' }).click()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'diskAgain',
  )
})

test('search filters slices', async ({ page }) => {
  await page.getByLabel('Search Slices').fill('generated')
  await expect(page.getByText('generatedTodo', { exact: true })).toBeVisible()
  await expect(page.getByText('addTodo', { exact: true })).toBeHidden()
})

test('mobile layout does not overflow and can save', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true)
  await page.getByLabel('Name', { exact: true }).fill('mobileTodo')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
})

test('saving prevents input until the submitted draft is persisted', async ({
  page,
}) => {
  let release = () => {}
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/specs', async (route) => {
    if (route.request().method() === 'PUT') await blocked
    await route.continue()
  })
  await page.getByLabel('Name', { exact: true }).fill('savedTodo')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  try {
    await expect(page.locator('main')).toHaveAttribute('inert', '')
    await page
      .getByLabel('Name', { exact: true })
      .evaluate((input) => (input as HTMLInputElement).focus())
    await page.keyboard.type('Lost')
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
      'savedTodo',
    )
  } finally {
    release()
  }
  await expect(page.locator('main')).not.toHaveAttribute('inert', '')
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
})

test('watch reload does not discard typing started during a slow read', async ({
  page,
  project,
}) => {
  let release = () => {}
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  let intercepted = false
  await page.route('**/api/specs', async (route) => {
    if (route.request().method() === 'GET') {
      const response = await route.fetch()
      intercepted = true
      await blocked
      await route.fulfill({ response })
    } else await route.continue()
  })
  await writeFile(project.editable, JSON.stringify(specification('diskTodo')))
  await expect.poll(() => intercepted).toBe(true)
  await page.getByLabel('Name', { exact: true }).fill('typedTodo')
  release()
  await expect(
    page.getByText('Disk changed. Reload before saving.'),
  ).toBeVisible()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'typedTodo',
  )
})

test('switching specs and scenarios refreshes JSON and read-only editors', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.locator('.cm-content').first()).not.toContainText('Ship it')
  await page.locator('.scenario-select').first().click()
  await expect(page.locator('.cm-content').first()).toContainText('Ship it')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByText('generatedTodo', { exact: true }).click()
  await expect(page.locator('.cm-content').first()).toHaveAttribute(
    'contenteditable',
    'false',
  )
  await page.getByText('addTodo', { exact: true }).click()
  await expect(page.locator('.cm-content').first()).toHaveAttribute(
    'contenteditable',
    'true',
  )
})

test('invalid JSON is treated as an unsaved edit during disk changes', async ({
  page,
  project,
}) => {
  const editor = page.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText('{')
  await expect(page.locator('.json-field .error').first()).toBeVisible()
  const invalidText = await editor.innerText()
  await writeFile(project.editable, JSON.stringify(specification('diskTodo')))
  await expect(
    page.getByText('Disk changed. Reload before saving.'),
  ).toBeVisible()
  await expect.poll(() => editor.innerText()).toBe(invalidText)
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
})

test('schema rejection leaves the existing file unchanged', async ({
  page,
  project,
}) => {
  const original = await readFile(project.editable, 'utf8')
  await page.getByLabel('Name', { exact: true }).fill('Invalid-Name')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('main')).not.toHaveAttribute('inert', '')
  await expect(page.locator('.brand small')).not.toContainText('Saving')
  expect(await readFile(project.editable, 'utf8')).toBe(original)
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Invalid-Name',
  )
  await page.getByLabel('Name', { exact: true }).fill('validTodo')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
})

test('another browser tab cannot overwrite a draft with a stale revision', async ({
  page,
  context,
}) => {
  const other = await context.newPage()
  await other.goto('/')
  await expect(other.getByLabel('Name', { exact: true })).toHaveValue('addTodo')
  await other.getByLabel('Name', { exact: true }).fill('staleTodo')
  await page.getByLabel('Name', { exact: true }).fill('firstTodo')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
  await expect(
    other.getByText('Disk changed. Reload before saving.'),
  ).toBeVisible()
  await expect(
    other.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
  await expect(other.getByLabel('Name', { exact: true })).toHaveValue(
    'staleTodo',
  )
  await other.getByRole('button', { name: 'Reload' }).click()
  await expect(other.getByLabel('Name', { exact: true })).toHaveValue(
    'firstTodo',
  )
})

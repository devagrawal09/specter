import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createSpecificationRepository,
  SpecEditorRepositoryError,
} from './repository'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  )
})

describe('specification repository', () => {
  it('discovers valid specifications and marks generated JSON read-only', async () => {
    const root = await project()
    const directory = resolve(root, 'src/features/todos/add-todo')
    await mkdir(directory, { recursive: true })
    await writeFile(
      resolve(directory, 'spec.json'),
      JSON.stringify(specification()),
    )
    await writeFile(resolve(directory, 'spec.ts'), 'export default {}')

    const repository = await createSpecificationRepository(root)
    const [file] = await repository.list()

    expect(file?.path).toBe('todos/add-todo/spec.json')
    expect(file?.readOnly).toBe(true)
    expect(file?.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    await expect(
      repository.save(file?.path ?? '', file?.revision ?? '', specification()),
    ).rejects.toMatchObject({ code: 'READ_ONLY' })
  })

  it('creates, atomically saves, detects conflicts, and removes only spec.json', async () => {
    const root = await project()
    const repository = await createSpecificationRepository(root)
    const path = 'todos/add-todo/spec.json'
    const created = await repository.create(path, specification())
    expect(created.document.name).toBe('addTodo')

    const changed = specification('Adds a todo safely.')
    const saved = await repository.save(path, created.revision, changed)
    expect(saved.document.description).toBe('Adds a todo safely.')
    await expect(
      repository.save(path, created.revision, specification()),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(await readdir(resolve(root, 'src/features/todos/add-todo'))).toEqual(
      ['spec.json'],
    )

    await writeFile(
      resolve(root, 'src/features/todos/add-todo/impl.ts'),
      'keep',
    )
    await repository.remove(path, saved.revision)
    expect(
      await readFile(
        resolve(root, 'src/features/todos/add-todo/impl.ts'),
        'utf8',
      ),
    ).toBe('keep')

    const removable = await repository.create(
      'todos/remove-me/spec.json',
      specification(),
    )
    await repository.remove(removable.path, removable.revision)
    expect(await readdir(resolve(root, 'src/features/todos'))).toEqual([
      'add-todo',
    ])
  })

  it('rejects traversal, absolute paths, invalid specs, and symlink paths', async () => {
    const root = await project()
    const repository = await createSpecificationRepository(root)
    await expect(
      repository.create('../spec.json', specification()),
    ).rejects.toBeInstanceOf(SpecEditorRepositoryError)
    await expect(
      repository.create('/tmp/spec.json', specification()),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(
      repository.create('todos/invalid/spec.json', { kind: 'command' }),
    ).rejects.toMatchObject({ code: 'INVALID_SPECIFICATION' })

    const outside = await mkdtemp(resolve(tmpdir(), 'specter-editor-outside-'))
    roots.push(outside)
    await symlink(outside, resolve(root, 'src/features/linked'))
    await expect(
      repository.create('linked/spec.json', specification()),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' })
  })
})

async function project() {
  const root = await mkdtemp(resolve(tmpdir(), 'specter-editor-'))
  roots.push(root)
  await mkdir(resolve(root, 'src/features'), { recursive: true })
  return root
}

function specification(description = 'Adds a todo.') {
  return {
    $schema: 'https://specter.dev/specification/v1/slice.schema.json',
    formatVersion: 1,
    kind: 'command',
    name: 'addTodo',
    description,
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
  }
}

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { type SpecEditorServer, startSpecEditor } from './server'

const roots: string[] = []
const servers: SpecEditorServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  )
})

describe('spec editor server', () => {
  it('serves specs, watches changes, and refuses an occupied fixed port', async () => {
    const root = await project()
    const path = resolve(root, 'src/features/todos/add-todo/spec.json')
    await mkdir(resolve(root, 'src/features/todos/add-todo'), {
      recursive: true,
    })
    await writeFile(path, JSON.stringify(specification('Adds a todo.')))
    const server = await startSpecEditor(root, { usePolling: true })
    servers.push(server)

    const response = await fetch(`${server.url}/api/specs`)
    expect(response.status).toBe(200)
    const files = (await response.json()) as Array<{
      path: string
      document: { description: string }
    }>
    expect(files).toMatchObject([
      {
        path: 'todos/add-todo/spec.json',
        document: { description: 'Adds a todo.' },
      },
    ])

    const createResponse = await fetch(`${server.url}/api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: 'todos/archive-todo/spec.json',
        document: specification('Archives a todo.'),
      }),
    })
    expect(createResponse.status).toBe(201)
    const created = (await createResponse.json()) as {
      revision: string
      document: { description: string }
    }
    expect(created.document.description).toBe('Archives a todo.')

    const saveResponse = await fetch(`${server.url}/api/specs`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: 'todos/archive-todo/spec.json',
        expectedRevision: created.revision,
        document: specification('Archives a todo safely.'),
      }),
    })
    expect(saveResponse.status).toBe(200)
    const saved = (await saveResponse.json()) as { revision: string }

    const conflictResponse = await fetch(`${server.url}/api/specs`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: 'todos/archive-todo/spec.json',
        expectedRevision: created.revision,
        document: specification('This revision is stale.'),
      }),
    })
    expect(conflictResponse.status).toBe(409)
    await expect(conflictResponse.json()).resolves.toMatchObject({
      code: 'REVISION_CONFLICT',
    })

    const deleteResponse = await fetch(`${server.url}/api/specs`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: 'todos/archive-todo/spec.json',
        expectedRevision: saved.revision,
      }),
    })
    expect(deleteResponse.status).toBe(204)

    await expect(
      startSpecEditor(root, { usePolling: true }),
    ).rejects.toMatchObject({
      code: 'EADDRINUSE',
    })

    const controller = new AbortController()
    const stream = await fetch(`${server.url}/api/watch`, {
      signal: controller.signal,
    })
    const reader = stream.body?.getReader()
    expect(reader).toBeDefined()
    await reader?.read()
    await writeFile(path, JSON.stringify(specification('Changed on disk.')))
    const event = await readEvent(reader)
    controller.abort()
    expect(event).toContain('todos/add-todo/spec.json')
  })
})

async function readEvent(
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
) {
  if (!reader) throw new Error('Missing event stream reader.')
  const decoder = new TextDecoder()
  return Promise.race([
    (async () => {
      let text = ''
      while (!text.includes('data:')) {
        const next = await reader.read()
        if (next.done) break
        text += decoder.decode(next.value, { stream: true })
      }
      return text
    })(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Timed out waiting for watch event.')),
        2_000,
      ),
    ),
  ])
}

async function project() {
  const root = await mkdtemp(resolve(tmpdir(), 'specter-editor-server-'))
  roots.push(root)
  await mkdir(resolve(root, 'src/features'), { recursive: true })
  return root
}

function specification(description: string) {
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

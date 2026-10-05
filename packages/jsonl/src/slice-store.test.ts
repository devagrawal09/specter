import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { testSliceStoreService } from '@specter-ts/core/testing'
import { Context, Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import type { SliceStoreService } from '@specter-ts/core'

import {
  createJsonlSliceStoreLayer,
  createJsonlSliceStoreService,
  JsonlSliceStoreFailure,
} from './slice-store'

const directories: string[] = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-jsonl-slices-'))
  directories.push(directory)
  return join(directory, 'nested', 'slices')
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

testSliceStoreService('jsonl', {
  createService: () =>
    createJsonlSliceStoreService(() => ({ value: 0 }), {
      directory: temporaryDirectory(),
    }),
  write: async (state, value: number) => {
    state.value = value
  },
  read: async (state) => state.value,
  value: 42,
})

testSliceStoreService('jsonl with fsync', {
  createService: () =>
    createJsonlSliceStoreService(() => ({ value: 0 }), {
      directory: temporaryDirectory(),
      fsync: true,
    }),
  write: async (state, value: number) => {
    state.value = value
  },
  read: async (state) => state.value,
  value: 42,
})

type TodoState = { todos: string[] }
const createTodoState = (): TodoState => ({ todos: [] })

function addTodo(
  service: SliceStoreService<Readonly<TodoState>, TodoState, unknown>,
  todo: string,
  order: number,
) {
  return Effect.runPromise(
    service.transaction('todosQuery', (write, _read, _cursor, publish) =>
      Effect.gen(function* () {
        write.todos.push(todo)
        yield* publish(order)
      }),
    ),
  )
}

const snapshot = (
  service: SliceStoreService<Readonly<TodoState>, TodoState, unknown>,
  sliceName = 'todosQuery',
) =>
  Effect.runPromise(
    service.read(sliceName, (state, cursor) =>
      Effect.succeed({ state, cursor }),
    ),
  )

describe('JSON file Slice Store', () => {
  it('reopens with the published state and cursor', async () => {
    const directory = temporaryDirectory()
    const first = createJsonlSliceStoreService(createTodoState, { directory })
    expect(await snapshot(first)).toEqual({ state: { todos: [] }, cursor: 0 })
    expect(existsSync(directory)).toBe(false)
    await addTodo(first, 'one', 3)
    await addTodo(first, 'two', 5)

    const reopened = createJsonlSliceStoreService(createTodoState, {
      directory,
    })
    expect(await snapshot(reopened)).toEqual({
      state: { todos: ['one', 'two'] },
      cursor: 5,
    })
    expect(await snapshot(reopened, 'otherQuery')).toEqual({
      state: { todos: [] },
      cursor: 0,
    })
    expect(
      JSON.parse(readFileSync(reopened.pathFor('todosQuery'), 'utf8')),
    ).toEqual({ cursor: 5, state: { todos: ['one', 'two'] } })
    expect(readdirSync(directory)).toEqual(['todosQuery.json'])
  })

  it('leaves the file unchanged when a transaction fails', async () => {
    const service = createJsonlSliceStoreService(createTodoState, {
      directory: temporaryDirectory(),
    })
    await addTodo(service, 'one', 1)
    const path = service.pathFor('todosQuery')
    const before = readFileSync(path, 'utf8')

    const failed = await Effect.runPromise(
      Effect.result(
        service.transaction('todosQuery', (write, _read, _cursor, publish) =>
          Effect.gen(function* () {
            write.todos.push('two')
            yield* publish(2)
            return yield* Effect.fail(new Error('projection failed'))
          }),
        ),
      ),
    )
    expect(failed._tag).toBe('Failure')
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(await snapshot(service)).toEqual({
      state: { todos: ['one'] },
      cursor: 1,
    })
  })

  it('does not write state that JSON cannot represent', async () => {
    const service = createJsonlSliceStoreService(
      (): { value: unknown } => ({ value: 1 }),
      { directory: temporaryDirectory() },
    )
    const result = await Effect.runPromise(
      Effect.result(
        service.transaction('valueQuery', (write, _read, _cursor, publish) =>
          Effect.gen(function* () {
            write.value = 10n
            yield* publish(1)
          }),
        ),
      ),
    )
    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure') {
      expect(result.failure).toBeInstanceOf(JsonlSliceStoreFailure)
      expect(result.failure).toMatchObject({ operation: 'write' })
    }
    expect(existsSync(service.pathFor('valueQuery'))).toBe(false)
    expect(await snapshot(service as never, 'valueQuery')).toEqual({
      state: { value: 1 },
      cursor: 0,
    })
  })

  it('returns decoded JSON before and after a reopen', async () => {
    const directory = temporaryDirectory()
    const first = createJsonlSliceStoreService(
      (): { at?: unknown; skipped?: unknown } => ({}),
      { directory },
    )
    await Effect.runPromise(
      first.transaction('dateQuery', (write, _read, _cursor, publish) =>
        Effect.gen(function* () {
          write.at = new Date('2026-01-02T03:04:05.000Z')
          write.skipped = undefined
          yield* publish(1)
        }),
      ),
    )
    const live = await snapshot(first as never, 'dateQuery')
    const reopened = createJsonlSliceStoreService(() => ({}), { directory })
    expect(live).toEqual({
      state: { at: '2026-01-02T03:04:05.000Z' },
      cursor: 1,
    })
    expect(await snapshot(reopened as never, 'dateQuery')).toEqual(live)
  })

  it('fails reads of malformed files and unsafe Slice names', async () => {
    const directory = temporaryDirectory()
    const service = createJsonlSliceStoreService(createTodoState, {
      directory,
    })
    await addTodo(service, 'one', 1)
    writeFileSync(service.pathFor('todosQuery'), '{"state":{}}\n')
    const reopened = createJsonlSliceStoreService(createTodoState, {
      directory,
    })
    for (const sliceName of ['todosQuery', '../escape']) {
      const result = await Effect.runPromise(
        Effect.result(
          reopened.read(sliceName, (_state, cursor) => Effect.succeed(cursor)),
        ),
      )
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        expect(result.failure).toMatchObject({ operation: 'read', sliceName })
      }
    }
  })

  it('provides the service through a Layer', async () => {
    const TodoStore = Context.Service<
      SliceStoreService<Readonly<TodoState>, TodoState, unknown>
    >('@specter/jsonl/test/TodoStore')
    const directory = temporaryDirectory()
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* TodoStore
        yield* Effect.promise(() => addTodo(store, 'one', 1))
      }).pipe(
        Effect.provide(
          createJsonlSliceStoreLayer(TodoStore, createTodoState, { directory }),
        ),
      ),
    )
    expect(
      await snapshot(
        createJsonlSliceStoreService(createTodoState, { directory }),
      ),
    ).toEqual({ state: { todos: ['one'] }, cursor: 1 })
  })
})

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createEventDefinition,
  createSpecterApp,
  implementCommand,
  implementReaction,
  type SliceStoreService,
} from '@specter-ts/core'
import { createImmediateReactionSchedulerLayer } from '@specter-ts/memory'
import {
  type OutboxedReaction,
  withReactionOutbox,
} from '@specter-ts/reaction-outbox'
import {
  createCommandSlice,
  createReactionSlice,
  event,
} from '@specter-ts/spec'
import { Context, Effect, Layer } from 'effect'
import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'

import { createJsonlEventLogLayer } from './event-log'
import {
  createJsonlReactionOutboxStore,
  type JsonlReactionOutboxStore,
} from './reaction-outbox'
import {
  createJsonlSliceStoreLayer,
  createJsonlSliceStoreService,
} from './slice-store'

const directories: string[] = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-jsonl-outbox-crash-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const run = Effect.runPromise

const notify = {
  id: 'notify:1',
  idempotencyKey: 'notify:1',
  payload: { message: 'hello' },
  requestedAt: new Date(0),
  availableAt: new Date(0),
}

const enqueuedLines = (path: string) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('{"type":"enqueued"'))

it('writes the enqueue before the Slice Store writes the cursor', async () => {
  const directory = temporaryDirectory()
  const path = join(directory, 'outbox.jsonl')
  const store = createJsonlSliceStoreService(() => ({ count: 0 }), {
    directory: join(directory, 'slices'),
  })
  const outbox = createJsonlReactionOutboxStore<{ message: string }>({ path })
  const observed: { lines: number; sliceFile: boolean }[] = []

  await run(
    store.transaction('notification', (write, _read, _cursor, publish) =>
      Effect.gen(function* () {
        write.count = 1
        yield* outbox.enqueue(notify)
        yield* publish(1)
        observed.push({
          lines: enqueuedLines(path).length,
          sliceFile: existsSync(store.pathFor('notification')),
        })
      }),
    ),
  )
  outbox.close()

  expect(observed).toEqual([{ lines: 1, sliceFile: false }])
  expect(
    JSON.parse(readFileSync(store.pathFor('notification'), 'utf8')),
  ).toEqual({ cursor: 1, state: { count: 1 } })
})

it('keeps an enqueue whose cursor write never happened, and ignores its replay', async () => {
  const directory = temporaryDirectory()
  const path = join(directory, 'outbox.jsonl')
  const slices = join(directory, 'slices')
  const transaction = (
    store: ReturnType<typeof createJsonlSliceStoreService<{ count: number }>>,
    outbox: JsonlReactionOutboxStore<{ message: string }>,
    crash: boolean,
  ) =>
    store.transaction('notification', (write, _read, _cursor, publish) =>
      Effect.gen(function* () {
        write.count = 1
        const enqueued = yield* outbox.enqueue(notify)
        yield* publish(1)
        // Stands in for the process dying before the cursor document lands.
        if (crash) return yield* Effect.fail('process exited')
        return enqueued.created
      }),
    )

  const first = createJsonlSliceStoreService(() => ({ count: 0 }), {
    directory: slices,
  })
  const outbox = createJsonlReactionOutboxStore<{ message: string }>({ path })
  await run(Effect.result(transaction(first, outbox, true)))
  outbox.close()

  // Restart: the cursor did not advance, but the job survived.
  const store = createJsonlSliceStoreService(() => ({ count: 0 }), {
    directory: slices,
  })
  const reopened = createJsonlReactionOutboxStore<{ message: string }>({
    path,
  })
  expect(
    await run(
      store.read('notification', (_read, cursor) => Effect.succeed(cursor)),
    ),
  ).toBe(0)
  expect(await run(reopened.list())).toMatchObject([
    { id: 'notify:1', status: 'pending' },
  ])

  // Core retries the Reaction with the same deliveryId; the enqueue is a no-op.
  expect(await run(transaction(store, reopened, false))).toBe(false)
  expect(
    await run(
      store.read('notification', (_read, cursor) => Effect.succeed(cursor)),
    ),
  ).toBe(1)
  expect(enqueuedLines(path)).toHaveLength(1)
  reopened.close()
})

type NoteState = { latest?: string }
const NoteStore = Context.Service<
  SliceStoreService<NoteState, NoteState, unknown>
>('@specter/jsonl/test/OutboxNoteStore')

const noteAdded = createEventDefinition(
  'note-added',
  z.object({ noteId: z.string() }),
)

function createConfig(
  outbox: JsonlReactionOutboxStore<OutboxedReaction<{ noteId: string }>>,
  delivered: string[],
) {
  const addNote = implementCommand(
    createCommandSlice('addNote')
      .description('Adds a note.')
      .scenarios({
        description: 'Adds the note.',
        given: [],
        when: { noteId: 'n1' },
        expect: [event('note-added', { noteId: 'n1' })],
      }),
  )
    .inputSchema(z.object({ noteId: z.string() }))
    .store(NoteStore)
    .handle(async (command) => [noteAdded.create(command)])

  const announceNote = implementReaction(
    createReactionSlice('announceNote')
      .description('Announces each added note outside Specter.')
      .scenarios({
        description: 'Announces the note.',
        given: [event('note-added', { noteId: 'n1' })],
        expect: [{ noteId: 'n1' }],
      }),
  )
    .outputSchema<{ noteId: string }>()
    .plugin(
      withReactionOutbox(
        () =>
          Effect.succeed((output: { noteId: string }) =>
            Effect.sync(() => {
              delivered.push(output.noteId)
            }),
          ),
        { store: outbox },
      ),
    )
    .store(NoteStore)
    .apply(noteAdded, async ({ payload }, state) => {
      state.latest = payload.noteId
    })
    .handle(async (state) =>
      state.latest ? { noteId: state.latest } : undefined,
    )

  return {
    events: [noteAdded],
    slices: { addNote, announceNote },
  } as const
}

it('delivers a Reaction exactly once when its cursor write fails after enqueue', async () => {
  const directory = temporaryDirectory()
  const path = join(directory, 'outbox.jsonl')
  const slices = join(directory, 'slices')
  const delivered: string[] = []
  const open = () => {
    const outbox = createJsonlReactionOutboxStore<
      OutboxedReaction<{ noteId: string }>
    >({ path })
    const app = createSpecterApp(
      createConfig(outbox, delivered),
      Layer.mergeAll(
        createJsonlEventLogLayer({ path: join(directory, 'events.jsonl') }),
        createJsonlSliceStoreLayer(NoteStore, () => ({}), {
          directory: slices,
        }),
        createImmediateReactionSchedulerLayer(),
      ),
    )
    return { outbox, app }
  }

  // A directory in place of the temporary file makes the cursor write fail.
  mkdirSync(join(slices, 'announceNote.json.tmp'), { recursive: true })
  const first = open()
  const app = await first.app
  const execution = await app.command({
    type: 'addNote',
    payload: { noteId: 'n1' },
  })
  await expect(execution.reactions).rejects.toBeDefined()
  // The in-process wake-up starts the durable job without a poll.
  for (let tries = 0; delivered.length === 0 && tries < 500; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  await app.close()
  first.outbox.close()
  expect(delivered).toEqual(['n1'])
  expect(existsSync(join(slices, 'announceNote.json'))).toBe(false)

  // Restart: core reruns the Reaction for the same commit and deliveryId.
  rmSync(join(slices, 'announceNote.json.tmp'), { recursive: true })
  const second = open()
  const reopened = await second.app
  // The first call waits for startup, which catches the Reaction up.
  const next = await reopened.command({
    type: 'addNote',
    payload: { noteId: 'n2' },
  })
  await next.reactions
  for (let tries = 0; delivered.length < 2 && tries < 500; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  await reopened.close()
  second.outbox.close()

  expect(delivered).toEqual(['n1', 'n2'])
  expect(enqueuedLines(path)).toHaveLength(2)
  expect(
    JSON.parse(readFileSync(join(slices, 'announceNote.json'), 'utf8')),
  ).toMatchObject({ cursor: 2 })
})

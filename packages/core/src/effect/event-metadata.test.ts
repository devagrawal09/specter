import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Effect, Exit, Layer, type Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  EventLog,
  type EventLogCommit,
  type EventLogDraft,
  EventLogFailure,
  type EventLogService,
  type PersistedEvent,
  type ReactionPlugin,
  SpecterInfrastructureError,
  createEventDefinition,
} from '..'
import {
  createCommandSlice,
  createQuerySlice,
  createReactionSlice,
  event,
} from '../definition'
import { createTestSliceStore } from '../testing/test-slice-store'
import { makeSpecterRuntime } from './runtime'

function schema<T>(): StandardSchemaV1<T, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'specter-event-metadata-test',
      validate: (value) => ({ value: value as T }),
    },
  }
}

type Note = { readonly noteId: string; readonly text: string }

const noteWritten = createEventDefinition('note-written', schema<Note>(), {
  keys: { note: (payload) => payload.noteId },
})

/** An in-memory Event Log that stores each Event's keys and returns them. */
function makeLog() {
  const events: PersistedEvent[] = []
  const commits: EventLogCommit[] = []
  const appended: EventLogDraft[][] = []
  const service: EventLogService = {
    capabilities: { scopedAppend: true, keyedRead: false },
    query: (after, types) =>
      Effect.sync(() =>
        events.filter(
          (item) => item.order > after && types.includes(item.type),
        ),
      ),
    readKey: () =>
      Effect.fail(new EventLogFailure('readKey', new Error('Unsupported.'))),
    currentVersion: Effect.sync(() => events.length),
    commitsAfter: (after) =>
      Effect.sync(() => commits.filter((commit) => commit.version > after)),
    findCommit: () => Effect.succeed(undefined),
    append: (drafts) =>
      Effect.sync(() => {
        appended.push([...drafts])
        const persisted = drafts.map((draft, index) => {
          const order = events.length + index + 1
          return {
            type: draft.type,
            payload: draft.payload,
            id: `event-${order}`,
            order,
            recordedAt: new Date(order).toISOString(),
            keys: draft.keys,
          }
        })
        events.push(...persisted)
        const commit = {
          events: persisted,
          version: events.length,
          committedAt: new Date(events.length).toISOString(),
        }
        commits.push(commit)
        return { ...commit, duplicate: false }
      }),
  }
  return { service, events, appended }
}

function writeNotes(decided: string[]) {
  const store = createTestSliceStore({})
  const slice = createCommandSlice('writeNotes')
    .description('Writes notes.')
    .scenarios({
      description: 'Writes a note.',
      given: [],
      when: [{ noteId: 'n1', text: 'one' }],
      expect: [event('note-written', { noteId: 'n1', text: 'one' })],
    })
    .inputSchema<readonly Note[]>()
    .store(store.tag)
    .handle(async (notes) => {
      decided.push('decided')
      return notes.map((note) => noteWritten.create(note))
    })
  return { slice, store }
}

const run = <A, E>(program: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(program))

describe('Event metadata in folds', () => {
  it('gives apply handlers the order, time and keys each Event was recorded with', async () => {
    const log = makeLog()
    const command = writeNotes([])
    const store = createTestSliceStore<{ notes: unknown[] }>({ notes: [] })
    const notes = createQuerySlice('notes')
      .description('Lists notes with when they were written.')
      .scenarios({
        description: 'Lists one note.',
        given: [event('note-written', { noteId: 'n1', text: 'one' })],
        when: {},
        expect: [],
      })
      .inputSchema<object>()
      .outputSchema<unknown[]>()
      .store(store.tag)
      .apply(noteWritten, async (written, state) => {
        state.notes.push({
          id: written.id,
          order: written.order,
          recordedAt: written.recordedAt,
          keys: written.keys,
        })
      })
      .handle(async (_query, state) => state.notes)

    const listed = await run(
      Effect.gen(function* () {
        const app = yield* makeSpecterRuntime({
          events: [noteWritten],
          slices: { writeNotes: command.slice, notes },
        } as const).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(EventLog, log.service),
              command.store.layer,
              store.layer,
            ),
          ),
        )
        yield* app.command({
          type: 'writeNotes',
          payload: [
            { noteId: 'n1', text: 'one' },
            { noteId: 'n2', text: 'two' },
          ],
        })
        return yield* app.query({ type: 'notes', payload: {} })
      }),
    )

    expect(listed).toEqual([
      {
        id: 'event-1',
        order: 1,
        recordedAt: new Date(1).toISOString(),
        keys: { note: 'n1' },
      },
      {
        id: 'event-2',
        order: 2,
        recordedAt: new Date(2).toISOString(),
        keys: { note: 'n2' },
      },
    ])
  })

  it('handles the key stored with each Event, not the one its definition derives now', async () => {
    const log = makeLog()
    const store = createTestSliceStore<{ seen: string[] }>({ seen: [] })
    const delivered: string[] = []
    const plugin: ReactionPlugin<string> = () =>
      Effect.succeed((output, context) =>
        Effect.sync(() => {
          delivered.push(`${context.deliveryId} ${output}`)
        }),
      )
    const noteWatch = createReactionSlice('noteWatch')
      .description('Reports each written note.')
      .scenarios({
        description: 'Reports a note.',
        given: [event('note-written', { noteId: 'n1', text: 'one' })],
        expect: ['n1'],
      })
      .outputSchema<string>()
      .plugin(plugin)
      .store(store.tag)
      .apply(noteWritten, async (written, state) => {
        state.seen.push(written.keys.note as string)
      })
      .handleEachKey('note', async (state, noteId) =>
        state.seen.includes(noteId) ? noteId : undefined,
      )
    // Appended when the definition derived another key from the payload.
    await Effect.runPromise(
      log.service.append([
        {
          type: 'note-written',
          payload: { noteId: 'n1', text: 'one' },
          keys: { note: 'archived-n1' },
        },
      ]),
    )

    const command = writeNotes([])
    await run(
      Effect.gen(function* () {
        yield* makeSpecterRuntime({
          events: [noteWritten],
          slices: { writeNotes: command.slice, noteWatch },
        } as const).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(EventLog, log.service),
              command.store.layer,
              store.layer,
            ),
          ),
        )
      }),
    )

    expect(delivered).toEqual(['noteWatch:1:archived-n1 archived-n1'])
  })

  it('refuses an Event its Event Log returned without the keys stored with it', async () => {
    const log = makeLog()
    const store = createTestSliceStore<{ count: number }>({ count: 0 })
    const notes = createQuerySlice('noteCount')
      .description('Counts notes.')
      .scenarios({
        description: 'Counts one note.',
        given: [event('note-written', { noteId: 'n1', text: 'one' })],
        when: {},
        expect: 1,
      })
      .inputSchema<object>()
      .outputSchema<number>()
      .store(store.tag)
      .apply(noteWritten, async (_written, state) => {
        state.count += 1
      })
      .handle(async (_query, state) => state.count)
    const withoutKeys: EventLogService = {
      ...log.service,
      query: (after, types) =>
        log.service
          .query(after, types)
          .pipe(
            Effect.map((events) =>
              events.map(({ keys: _, ...rest }) => rest as PersistedEvent),
            ),
          ),
    }
    await Effect.runPromise(
      log.service.append([
        {
          type: 'note-written',
          payload: { noteId: 'n1', text: 'one' },
          keys: { note: 'n1' },
        },
      ]),
    )

    const command = writeNotes([])
    const exit = await run(
      Effect.gen(function* () {
        const app = yield* makeSpecterRuntime({
          events: [noteWritten],
          slices: { writeNotes: command.slice, noteCount: notes },
        } as const).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(EventLog, withoutKeys),
              command.store.layer,
              store.layer,
            ),
          ),
        )
        return yield* Effect.exit(app.query({ type: 'noteCount', payload: {} }))
      }),
    )

    expect(Exit.isFailure(exit) && failureOf(exit)).toBeInstanceOf(
      SpecterInfrastructureError,
    )
  })
})

function failureOf(exit: Exit.Exit<unknown, unknown>) {
  if (!Exit.isFailure(exit)) return undefined
  const reason = exit.cause.reasons.find((candidate) => 'error' in candidate)
  return reason && 'error' in reason ? reason.error : undefined
}

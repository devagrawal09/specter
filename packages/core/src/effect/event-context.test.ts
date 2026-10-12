import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Effect, Exit, Layer, type Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  type CommandDispatchOptions,
  type EventContext,
  type EventDraft,
  EventLog,
  type EventLogCommit,
  type EventLogDraft,
  EventLogFailure,
  type EventLogService,
  type PersistedEvent,
  SpecterInfrastructureError,
  SpecterInvalidCommandOptionsError,
  createEventDefinition,
} from '..'
import { createCommandSlice, createQuerySlice, event } from '../definition'
import { createTestSliceStore } from '../testing/test-slice-store'
import { makeSpecterRuntime } from './runtime'

function schema<T>(): StandardSchemaV1<T, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'specter-event-context-test',
      validate: (value) => ({ value: value as T }),
    },
  }
}

type Note = { readonly noteId: string; readonly text: string }

const noteWritten = createEventDefinition('note-written', schema<Note>(), {
  keys: { note: (payload) => payload.noteId },
})

/**
 * An in-memory Event Log that keeps the drafts it was handed, metadata
 * included, and stores each Event under the host's ID and time when given.
 */
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
            id: draft.id ?? `event-${order}`,
            order,
            recordedAt: draft.recordedAt ?? new Date(order).toISOString(),
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

async function dispatch(options: CommandDispatchOptions) {
  const log = makeLog()
  const calls: string[] = []
  const command = writeNotes(calls)
  const exit = await run(
    Effect.gen(function* () {
      const app = yield* makeSpecterRuntime({
        events: [noteWritten],
        slices: { writeNotes: command.slice },
      } as const).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(EventLog, log.service),
            command.store.layer,
          ),
        ),
      )
      return yield* Effect.exit(
        app.command(
          {
            type: 'writeNotes',
            payload: [
              { noteId: 'n1', text: 'one' },
              { noteId: 'n2', text: 'two' },
            ],
          },
          {
            ...options,
            ...(typeof options.eventContext === 'function'
              ? {
                  eventContext: (draft: EventDraft, index: number) => {
                    calls.push(`context ${index}`)
                    return options.eventContext?.(draft, index)
                  },
                }
              : {}),
          },
        ),
      )
    }),
  )
  return { exit, log, calls }
}

describe('host context on dispatch', () => {
  it("stores each Event under the host's ID and time and hands its metadata to the Event Log", async () => {
    const seen: Array<{ readonly draft: EventDraft; readonly index: number }> =
      []
    const location = { directory: '/work' }
    const { exit, log, calls } = await dispatch({
      eventContext: (draft, index) => {
        seen.push({ draft, index })
        return index === 0
          ? {
              id: 'host-note-1',
              recordedAt: '2026-10-12T08:00:00.000Z',
              metadata: { location },
            }
          : undefined
      },
    })

    expect(Exit.isSuccess(exit)).toBe(true)
    // After the decision, once per Event, with its draft and position.
    expect(calls).toEqual(['decided', 'context 0', 'context 1'])
    expect(seen).toEqual([
      {
        draft: { type: 'note-written', payload: { noteId: 'n1', text: 'one' } },
        index: 0,
      },
      {
        draft: { type: 'note-written', payload: { noteId: 'n2', text: 'two' } },
        index: 1,
      },
    ])
    expect(log.appended).toEqual([
      [
        {
          type: 'note-written',
          payload: { noteId: 'n1', text: 'one' },
          keys: { note: 'n1' },
          id: 'host-note-1',
          recordedAt: '2026-10-12T08:00:00.000Z',
          metadata: { location },
        },
        {
          type: 'note-written',
          payload: { noteId: 'n2', text: 'two' },
          keys: { note: 'n2' },
        },
      ],
    ])
    // The metadata reaches the adapter as the host gave it, not a copy.
    expect(log.appended[0]?.[0]?.metadata).toEqual({ location })
    expect(
      (log.appended[0]?.[0]?.metadata as { location: object }).location,
    ).toBe(location)
    const receipt = Exit.isSuccess(exit) ? exit.value : undefined
    expect(
      receipt?.events.map(({ id, recordedAt, keys }) => ({
        id,
        recordedAt,
        keys,
      })),
    ).toEqual([
      {
        id: 'host-note-1',
        recordedAt: '2026-10-12T08:00:00.000Z',
        keys: { note: 'n1' },
      },
      {
        id: 'event-2',
        recordedAt: new Date(2).toISOString(),
        keys: { note: 'n2' },
      },
    ])
  })

  it('lets a fold read the time the host recorded an Event at', async () => {
    const log = makeLog()
    const command = writeNotes([])
    const store = createTestSliceStore<{ times: string[] }>({ times: [] })
    const noteTimes = createQuerySlice('noteTimes')
      .description('Lists when notes were written.')
      .scenarios({
        description: 'Lists one time.',
        given: [event('note-written', { noteId: 'n1', text: 'one' })],
        when: {},
        expect: ['1970-01-01T00:00:01.000Z'],
      })
      .inputSchema<object>()
      .outputSchema<string[]>()
      .store(store.tag)
      .apply(noteWritten, async (written, state) => {
        state.times.push(written.recordedAt)
      })
      .handle(async (_query, state) => state.times)

    const times = await run(
      Effect.gen(function* () {
        const app = yield* makeSpecterRuntime({
          events: [noteWritten],
          slices: { writeNotes: command.slice, noteTimes },
        } as const).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(EventLog, log.service),
              command.store.layer,
              store.layer,
            ),
          ),
        )
        yield* app.command(
          {
            type: 'writeNotes',
            payload: [
              { noteId: 'n1', text: 'one' },
              { noteId: 'n2', text: 'two' },
            ],
          },
          {
            eventContext: (_draft, index) =>
              index === 1 ? { recordedAt: '2026-10-12T08:00:00.000Z' } : {},
          },
        )
        return yield* app.query({ type: 'noteTimes', payload: {} })
      }),
    )

    expect(times).toEqual([
      new Date(1).toISOString(),
      '2026-10-12T08:00:00.000Z',
    ])
  })

  it.each<[string, (draft: EventDraft, index: number) => EventContext]>([
    ['a blank ID', () => ({ id: ' ' })],
    ['the same ID for two Events', () => ({ id: 'same' })],
    ['a time that is not ISO-8601', () => ({ recordedAt: '12 October 2026' })],
    [
      'a time in another time zone',
      () => ({ recordedAt: '2026-10-12T10:00:00.000+02:00' }),
    ],
  ])('refuses context with %s and appends nothing', async (_, eventContext) => {
    const { exit, log } = await dispatch({ eventContext })

    expect(Exit.isFailure(exit)).toBe(true)
    expect(Exit.isFailure(exit) && failureOf(exit)).toBeInstanceOf(
      SpecterInvalidCommandOptionsError,
    )
    expect(log.appended).toEqual([])
  })

  it('refuses an eventContext that is not a function before deciding', async () => {
    const { exit, log, calls } = await dispatch({
      eventContext: 'host' as unknown as CommandDispatchOptions['eventContext'],
    })

    expect(Exit.isFailure(exit) && failureOf(exit)).toBeInstanceOf(
      SpecterInvalidCommandOptionsError,
    )
    expect(calls).toEqual([])
    expect(log.appended).toEqual([])
  })

  it('fails the Command when the context throws, and appends nothing', async () => {
    const { exit, log } = await dispatch({
      eventContext: () => {
        throw new Error('No clock.')
      },
    })

    expect(Exit.isFailure(exit) && failureOf(exit)).toBeInstanceOf(
      SpecterInfrastructureError,
    )
    expect(log.appended).toEqual([])
  })
})

function failureOf(exit: Exit.Exit<unknown, unknown>) {
  if (!Exit.isFailure(exit)) return undefined
  const reason = exit.cause.reasons.find((candidate) => 'error' in candidate)
  return reason && 'error' in reason ? reason.error : undefined
}

import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Effect } from 'effect'

import { createEventDefinition } from '..'
import { createQuerySlice, event } from '../definition'
import { testSliceImplementation } from './scenarios'
import { createTestSliceStore } from './test-slice-store'

function schema<T>(): StandardSchemaV1<T, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'specter-metadata-test',
      validate: (value) => ({ value: value as T }),
    },
  }
}

const noteWritten = createEventDefinition(
  'note-written',
  schema<{ readonly noteId: string }>(),
  { keys: { note: (payload) => payload.noteId } },
)
const noteRead = createEventDefinition(
  'note-read',
  schema<{ readonly noteId: string }>(),
)

type Recorded = {
  readonly id: string
  readonly order: number
  readonly recordedAt: string
  readonly keys: Readonly<Record<string, string>>
}

const store = createTestSliceStore<{ recorded: Recorded[] }>({ recorded: [] })

// Given Event N has order N, is recorded N seconds after the Unix epoch, and
// carries the keys its definition derives.
const noteLog = createQuerySlice('noteLog')
  .description('Lists when each note was written.')
  .scenarios({
    description:
      'Lists two notes in the order and at the times they were written.',
    given: [
      event('note-written', { noteId: 'n1' }),
      event('note-read', { noteId: 'n1' }),
      event('note-written', { noteId: 'n2' }),
    ],
    when: {},
    expect: [
      {
        id: 'scenario-event-1',
        order: 1,
        recordedAt: '1970-01-01T00:00:01.000Z',
        keys: { note: 'n1' },
      },
      {
        id: 'scenario-event-2',
        order: 2,
        recordedAt: '1970-01-01T00:00:02.000Z',
        keys: {},
      },
      {
        id: 'scenario-event-3',
        order: 3,
        recordedAt: '1970-01-01T00:00:03.000Z',
        keys: { note: 'n2' },
      },
    ],
  })
  .inputSchema<object>()
  .outputSchema<readonly Recorded[]>()
  .store(store.tag)
  .apply(noteWritten, async (written, state) => {
    const { id, order, recordedAt, keys } = written
    state.recorded.push({ id, order, recordedAt, keys })
  })
  .apply(noteRead, async (read, state) => {
    const { id, order, recordedAt, keys } = read
    state.recorded.push({ id, order, recordedAt, keys })
  })
  .handle(async (_query, state) => state.recorded)

testSliceImplementation(noteLog, {
  events: [noteWritten, noteRead],
  runScenario: (program) => {
    store.reset()
    return Effect.runPromise(
      program.pipe(Effect.provide(store.layer)) as Effect.Effect<never>,
    )
  },
})

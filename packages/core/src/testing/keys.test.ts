import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { createEventDefinition } from '..'
import { assertConforms, createCommandSlice, event } from '../definition'
import { checkCommandScenario } from './scenarios'
import { createTestSliceStore } from './test-slice-store'

function schema<T>(): StandardSchemaV1<T, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'specter-keys-test',
      validate: (value) => ({ value: value as T }),
    },
  }
}

type Created = { readonly id: string; readonly parentId?: string }

const created = createEventDefinition('thing-created', schema<Created>(), {
  keys: (payload) => [payload.id],
})
const removed = createEventDefinition(
  'thing-removed',
  schema<{ readonly id: string }>(),
  { keys: (payload) => [payload.id] },
)
const events = [created, removed]

type State = { live: Record<string, boolean> }

function isolated() {
  const store = createTestSliceStore<State>({ live: {} })
  return {
    store,
    runScenario: <T>(program: Effect.Effect<T, unknown, unknown>) => {
      store.reset()
      return Effect.runPromise(
        program.pipe(Effect.provide(store.layer)) as Effect.Effect<T>,
      )
    },
  }
}

function createChild(keys: (command: Created) => readonly string[]) {
  const { store, runScenario } = isolated()
  const slice = createCommandSlice('createChild')
    .description('Creates a thing under a live parent.')
    .scenarios(
      {
        description: 'Creates a child of a live parent, whatever else lives.',
        given: [
          event('thing-created', { id: 'parent' }),
          event('thing-created', { id: 'other' }),
          event('thing-removed', { id: 'other' }),
        ],
        when: { id: 'child', parentId: 'parent' },
        expect: [event('thing-created', { id: 'child', parentId: 'parent' })],
      },
      {
        description: 'Refuses a removed parent.',
        given: [
          event('thing-created', { id: 'parent' }),
          event('thing-removed', { id: 'parent' }),
        ],
        when: { id: 'child', parentId: 'parent' },
        expect: [],
        reject: { reason: 'Parent removed' },
      },
    )
    .inputSchema<Created>()
    .consistencyKeys(keys)
    .store(store.tag)
    .apply(created, async (applied, state) => {
      state.live[applied.payload.id] = true
    })
    .apply(removed, async (applied, state) => {
      state.live[applied.payload.id] = false
    })
    .handle(async (command, state) => {
      if (command.parentId && state.live[command.parentId] === false) {
        throw new Error('Parent removed')
      }
      return [created.create(command)]
    })
  return { slice, runScenario }
}

describe('consistency keys in Scenarios', () => {
  it('passes when the Command decides the same from only the Events carrying its keys', async () => {
    const { slice, runScenario } = createChild((command) => [
      command.id,
      ...(command.parentId ? [command.parentId] : []),
    ])
    for (const scenario of slice.scenarios) {
      await checkCommandScenario(slice, scenario, events, runScenario)
    }
  })

  it('fails a Scenario whose decision reads Events its keys leave out', async () => {
    // The parent's removal decides, but only the child's key is declared.
    const { slice, runScenario } = createChild((command) => [command.id])
    const [, refusal] = slice.scenarios
    await expect(
      checkCommandScenario(slice, refusal, events, runScenario),
    ).rejects.toThrow(
      /differently from only the Given Events that carry its consistency keys \(child\)/,
    )
  })
})

describe('Event keys in conformance', () => {
  it('reports a key function that does not return strings for a Scenario Event', async () => {
    const broken = createEventDefinition('thing-created', schema<Created>(), {
      keys: (payload) => [payload.parentId as string],
    })
    const { store } = isolated()
    const slice = createCommandSlice('createThing')
      .description('Creates a thing.')
      .scenarios({
        description: 'Creates a thing.',
        given: [],
        when: { id: 'a' },
        expect: [event('thing-created', { id: 'a' })],
      })
      .inputSchema<Created>()
      .store(store.tag)
      .handle(async (command) => [broken.create(command)])
    const failure = await Effect.runPromise(
      Effect.flip(
        assertConforms({ events: [broken], slices: { createThing: slice } }),
      ),
    )
    expect(failure.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'event-keys',
    ])
  })
})

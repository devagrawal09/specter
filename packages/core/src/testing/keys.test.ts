import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { createEventDefinition } from '..'
import {
  assertConforms,
  createCommandSlice,
  createReactionSlice,
  event,
} from '../definition'
import { checkCommandScenario, checkReactionScenario } from './scenarios'
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
    .store(store.tag)
    .consistencyKeys(keys)
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
  it('passes when Events carrying none of its keys cannot change the decision', async () => {
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
      /differently without its last Given Events, which carry none of its consistency keys \(child\)/,
    )
  })
})

describe('consistency keys and history', () => {
  it("accepts a decision that read another key's past through an Event carrying its own key", async () => {
    const copied = createEventDefinition(
      'thing-copied',
      schema<{ readonly id: string; readonly from: string }>(),
      { keys: (payload) => [payload.id] },
    )
    const { store, runScenario } = isolated()
    const slice = createCommandSlice('touchThing')
      .description('Touches a live thing.')
      .scenarios({
        description:
          'Touches a copy made while its source lived, whatever happened to the source since.',
        given: [
          event('thing-created', { id: 'source' }),
          event('thing-copied', { id: 'copy', from: 'source' }),
          event('thing-removed', { id: 'source' }),
        ],
        when: { id: 'copy' },
        expect: [event('thing-created', { id: 'copy' })],
      })
      .inputSchema<Created>()
      .store(store.tag)
      .consistencyKeys((command) => [command.id])
      .apply(created, async (applied, state) => {
        state.live[applied.payload.id] = true
      })
      .apply(copied, async (applied, state) => {
        state.live[applied.payload.id] =
          state.live[applied.payload.from] ?? false
      })
      .apply(removed, async (applied, state) => {
        state.live[applied.payload.id] = false
      })
      .handle(async (command, state) => {
        if (!state.live[command.id]) throw new Error('Thing not live')
        return [created.create({ id: command.id })]
      })
    // The source's removal follows every Event carrying "copy", so it is
    // what a concurrent writer could append: the decision must not depend on
    // it, and does not. The source's creation precedes the copy.
    await checkCommandScenario(
      slice,
      slice.scenarios[0],
      [created, copied, removed],
      runScenario,
    )
  })
})

describe('keyed Reaction Scenarios', () => {
  function watch(
    handle: (state: State, key: string) => Promise<string | undefined>,
  ) {
    const { store, runScenario } = isolated()
    const slice = createReactionSlice('watchThings')
      .description('Reports each live thing.')
      .scenarios({
        description: 'Reports every live thing, in the order its key appears.',
        given: [
          event('thing-created', { id: 'b' }),
          event('thing-created', { id: 'a' }),
          event('thing-created', { id: 'c' }),
          event('thing-removed', { id: 'c' }),
        ],
        expect: ['b', 'a'],
      })
      .outputSchema<string>()
      .plugin(() => Effect.succeed(() => Effect.void))
      .store(store.tag)
      .apply(created, async (applied, state) => {
        state.live[applied.payload.id] = true
      })
      .apply(removed, async (applied, state) => {
        state.live[applied.payload.id] = false
      })
      .handleEachKey(handle)
    return { slice, runScenario }
  }

  it('expects one value per key the Given Events carry', async () => {
    const { slice, runScenario } = watch(async (state, key) =>
      state.live[key] ? key : undefined,
    )
    await checkReactionScenario(slice, slice.scenarios[0], events, runScenario)
  })

  it("fails a handler that reads another key's State", async () => {
    // Reports b only while c lives: b's output depends on c's Events.
    const { slice, runScenario } = watch(async (state, key) =>
      state.live[key] && (key !== 'b' || state.live.c === false)
        ? key
        : undefined,
    )
    await expect(
      checkReactionScenario(slice, slice.scenarios[0], events, runScenario),
    ).rejects.toThrow(/handles key "b"/)
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

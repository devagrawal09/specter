import type { StandardSchemaV1 } from '@standard-schema/spec'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { createEventDefinition } from '..'
import {
  type ApplyEventDefinition,
  assertConforms,
  createCommandSlice,
  createReactionSlice,
  event,
  type SliceRegistration,
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

// A thing's creation names the thing and, for a child, its parent: a parent
// is a thing too, but `parent` is another key.
const created = createEventDefinition('thing-created', schema<Created>(), {
  keys: {
    thing: (payload) => payload.id,
    parent: (payload) => payload.parentId,
  },
})
const removed = createEventDefinition(
  'thing-removed',
  schema<{ readonly id: string }>(),
  { keys: { thing: (payload) => payload.id } },
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

function createChild(things: (command: Created) => string | readonly string[]) {
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
    .consistencyKeys({ thing: things })
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
    // The parent is a thing the decision reads, under its own `thing` key.
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
    const { slice, runScenario } = createChild((command) => command.id)
    const [, refusal] = slice.scenarios
    await expect(
      checkCommandScenario(slice, refusal, events, runScenario),
    ).rejects.toThrow(
      /differently without its last Given Events, which carry none of its consistency keys \(thing: child\)/,
    )
  })
})

describe('consistency keys and history', () => {
  it("accepts a decision that read another key's past through an Event carrying its own key", async () => {
    const copied = createEventDefinition(
      'thing-copied',
      schema<{ readonly id: string; readonly from: string }>(),
      { keys: { thing: (payload) => payload.id } },
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
      .consistencyKeys({ thing: (command) => command.id })
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
      .handleEachKey('thing', handle)
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
    ).rejects.toThrow(/handles thing "b"/)
  })
})

describe('Event keys in conformance', () => {
  const { store } = isolated()
  const diagnosticsOf = (
    eventDefinitions: readonly ApplyEventDefinition[],
    slices: Readonly<Record<string, SliceRegistration>>,
  ) =>
    Effect.runPromise(
      Effect.flip(
        assertConforms(
          { events: eventDefinitions, slices },
          { requireEveryEventInAScenario: false },
        ),
      ),
    ).then((failure) =>
      failure.diagnostics.map((diagnostic) => diagnostic.code),
    )

  function createThing(definition: typeof created) {
    return createCommandSlice('createThing')
      .description('Creates a thing.')
      .scenarios({
        description: 'Creates a thing.',
        given: [],
        when: { id: 'a' },
        expect: [event('thing-created', { id: 'a' })],
      })
      .inputSchema<Created>()
      .store(store.tag)
      .handle(async (command) => [definition.create(command)])
  }

  it('reports a key function that does not return a string or undefined', async () => {
    const broken = createEventDefinition('thing-created', schema<Created>(), {
      keys: { thing: (payload) => payload.id.length as unknown as string },
    })
    await expect(
      diagnosticsOf([broken], { createThing: createThing(broken) }),
    ).resolves.toEqual(['event-keys'])
  })

  it('reports a key name that is not lower camel case', async () => {
    const misnamed = createEventDefinition('thing-created', schema<Created>(), {
      keys: { 'thing-id': (payload) => payload.id },
    })
    await expect(
      diagnosticsOf([misnamed], { createThing: createThing(misnamed) }),
    ).resolves.toEqual(['event-key-name'])
  })

  it('reports a keyed Command that applies an Event type declaring none of its keys, or names a key nothing declares', async () => {
    const noted = createEventDefinition(
      'thing-noted',
      schema<{ readonly note: string }>(),
    )
    const slice = createCommandSlice('noteThing')
      .description('Notes a thing.')
      .scenarios({
        description: 'Notes a thing.',
        given: [event('thing-noted', { note: 'n' })],
        when: { id: 'a' },
        expect: [event('thing-created', { id: 'a' })],
      })
      .inputSchema<Created>()
      .store(store.tag)
      .consistencyKeys({
        thing: (command) => command.id,
        widget: (command) => command.id,
      })
      .apply(noted, async () => {})
      .handle(async (command) => [created.create(command)])
    await expect(
      diagnosticsOf([created, noted], { noteThing: slice }),
    ).resolves.toEqual([
      'keyed-command-undeclared-key',
      'keyed-command-unused-key',
      'keyed-command-unused-key',
    ])
  })

  it('reports a Scenario Event without a key a keyed Slice applies its type by', async () => {
    const watch = createReactionSlice('watchParents')
      .description('Reports each parent that gains a child.')
      .scenarios({
        description: 'Reports a parent.',
        given: [event('thing-created', { id: 'a', parentId: 'p' })],
        expect: [],
      })
      .outputSchema<string>()
      .plugin(() => Effect.succeed(() => Effect.void))
      .store(store.tag)
      .apply(created, async () => {})
      .handleEachKey('parent', async () => undefined)
    // createThing's outcome has no parent, which watchParents applies it by.
    await expect(
      diagnosticsOf([created], {
        createThing: createThing(created),
        watchParents: watch,
      }),
    ).resolves.toEqual(['event-missing-key'])
  })
})

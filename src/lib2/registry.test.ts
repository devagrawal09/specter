// biome-ignore-all lint/suspicious/noExplicitAny: test helpers accept reaction callbacks with arbitrary Effect services.
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import * as SqliteDrizzle from '@effect/sql-drizzle/Sqlite'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { Effect } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  createEventSpec,
  createRegistry,
  createRegistryRuntimeLayer,
  DuplicateCommandNameError,
  DuplicateSliceNameError,
  InvalidCommandError,
  InvalidProjectionInputError,
  reactToScenario,
  UnknownProjectionError,
} from './index'
import type { Event } from './event'
import type { ReactionExec, ReactionSlice } from './slice'

const thingCreated = createEventSpec(
  'thingCreated',
  z.object({ name: z.string() }),
)
const greetingSent = createEventSpec(
  'greetingSent',
  z.object({ name: z.string() }),
)

const thingNames = sqliteTable('thing_names', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
})

const reactionStates = sqliteTable('reaction_states', {
  sliceName: text('slice_name').primaryKey(),
  name: text('name'),
})

function createTestRuntime() {
  const directory = mkdtempSync(join(tmpdir(), 'specter-registry-'))
  const sqliteFilename = join(directory, 'registry.sqlite')
  const sqlite = new Database(sqliteFilename)

  sqlite.exec(
    'create table events ("order" integer primary key autoincrement, id text not null unique, type text not null, payload text not null, created_at integer not null); create index events_order_idx on events ("order"); create table slice_cursors (slice_name text primary key not null, last_applied_order integer not null); create table thing_names (id integer primary key autoincrement, name text not null); create table reaction_states (slice_name text primary key not null, name text);',
  )
  sqlite.close()

  return {
    layer: createRegistryRuntimeLayer({ sqliteFilename }),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  }
}

const createThingCommand = {
  kind: 'command' as const,
  name: 'createThing',
  schema: z.object({ name: z.string() }),
  decide: (payload: unknown) =>
    Effect.succeed([thingCreated.create(payload as { name: string })]),
}

const sendGreetingCommand = {
  kind: 'command' as const,
  name: 'sendGreeting',
  schema: z.object({ name: z.string() }),
  decide: (payload: unknown) =>
    Effect.succeed([greetingSent.create(payload as { name: string })]),
}

function greetingReaction<
  TPayload = { name: string; payload: { name: string } },
>(
  name: string,
  react: (
    name: string | null,
    exec: ReactionExec<TPayload>,
  ) => Effect.Effect<void, unknown, any>,
): ReactionSlice<string, TPayload> {
  return {
    kind: 'reaction' as const,
    name,
    apply: {
      thingCreated: (event: Event, input: unknown) =>
        Effect.gen(function* () {
          const db = input as unknown as SqliteRemoteDatabase
          const payload = event.payload as { name: string }

          yield* db
            .insert(reactionStates)
            .values({ sliceName: name, name: payload.name })
            .onConflictDoUpdate({
              target: reactionStates.sliceName,
              set: { name: payload.name },
            })
        }),
    },
    react: (exec: ReactionExec<TPayload>) =>
      Effect.gen(function* () {
        const db = yield* SqliteDrizzle.SqliteDrizzle
        const rows = yield* db
          .select()
          .from(reactionStates)
          .where(eq(reactionStates.sliceName, name))

        return yield* react(rows[0]?.name ?? null, exec)
      }),
  }
}

describe('lib2 registry', () => {
  it('dispatches a command and persists its events', async () => {
    const runtime = createTestRuntime()

    try {
      const registry = createRegistry([createThingCommand])

      const events = await Effect.runPromise(
        registry
          .dispatch({
            name: 'createThing',
            payload: { name: 'Ada' },
          })
          .pipe(Effect.provide(runtime.layer)),
      )

      expect(events).toEqual([
        expect.objectContaining({
          id: expect.any(String),
          type: 'thingCreated',
          payload: { name: 'Ada' },
        }),
      ])
    } finally {
      runtime.cleanup()
    }
  })

  it('catches up a projection before querying', async () => {
    const runtime = createTestRuntime()

    try {
      const registry = createRegistry([
        createThingCommand,
        {
          kind: 'projection',
          name: 'thingNames',
          schema: z.object({}),
          apply: {
            thingCreated: (event: Event, input: unknown) =>
              Effect.gen(function* () {
                const db = input as unknown as SqliteRemoteDatabase
                const payload = event.payload as { name: string }

                yield* db.insert(thingNames).values({ name: payload.name })
              }),
          },
          query: (input) =>
            Effect.gen(function* () {
              const db = input as unknown as SqliteRemoteDatabase
              const rows = yield* db.select().from(thingNames)

              return rows.map((row) => row.name)
            }),
        },
      ])

      await Effect.runPromise(
        registry
          .dispatch({ name: 'createThing', payload: { name: 'Ada' } })
          .pipe(Effect.provide(runtime.layer)),
      )

      await expect(
        Effect.runPromise(
          registry.query('thingNames', {}).pipe(Effect.provide(runtime.layer)),
        ),
      ).resolves.toEqual(['Ada'])
    } finally {
      runtime.cleanup()
    }
  })

  it('streams commands returned by reactions', async () => {
    const runtime = createTestRuntime()

    try {
      const registry = createRegistry([
        createThingCommand,
        sendGreetingCommand,
        greetingReaction('greetNewThings', (name, exec) =>
          name
            ? exec({ name: 'sendGreeting', payload: { name } })
            : Effect.succeed(undefined),
        ),
      ])

      const events = await Effect.runPromise(
        registry
          .dispatch({
            name: 'createThing',
            payload: { name: 'Ada' },
          })
          .pipe(Effect.provide(runtime.layer)),
      )

      expect(events.map((event) => event.type)).toEqual([
        'thingCreated',
        'greetingSent',
      ])
      expect(events.map((event) => event.payload)).toEqual([
        { name: 'Ada' },
        { name: 'Ada' },
      ])
    } finally {
      runtime.cleanup()
    }
  })

  it('continues draining reactions after a reaction emits no commands', async () => {
    const runtime = createTestRuntime()

    try {
      const registry = createRegistry([
        createThingCommand,
        sendGreetingCommand,
        greetingReaction('greetOnlyGrace', (name, exec) =>
          name === 'Grace'
            ? exec({ name: 'sendGreeting', payload: { name } })
            : Effect.succeed(undefined),
        ),
      ])

      await Effect.runPromise(
        registry
          .dispatch({ name: 'createThing', payload: { name: 'Ada' } })
          .pipe(Effect.provide(runtime.layer)),
      )

      const events = await Effect.runPromise(
        registry
          .dispatch({
            name: 'createThing',
            payload: { name: 'Grace' },
          })
          .pipe(Effect.provide(runtime.layer)),
      )

      expect(events.map((event) => event.type)).toEqual([
        'thingCreated',
        'greetingSent',
      ])
      expect(events.map((event) => event.payload)).toEqual([
        { name: 'Grace' },
        { name: 'Grace' },
      ])
    } finally {
      runtime.cleanup()
    }
  })

  it('resumes failed reactions from their last successful cursor', async () => {
    const runtime = createTestRuntime()
    let failReaction = true

    try {
      const registry = createRegistry([
        createThingCommand,
        sendGreetingCommand,
        greetingReaction('greetNewThings', (name, exec) =>
          Effect.sync(() => {
            if (failReaction) {
              throw new Error('reaction failed')
            }

            return name
          }).pipe(
            Effect.flatMap((currentName) =>
              currentName
                ? exec({ name: 'sendGreeting', payload: { name: currentName } })
                : Effect.succeed(undefined),
            ),
          ),
        ),
      ])

      await expect(
        Effect.runPromise(
          registry
            .dispatch({
              name: 'createThing',
              payload: { name: 'Ada' },
            })
            .pipe(Effect.provide(runtime.layer)),
        ),
      ).rejects.toThrow('reaction failed')

      failReaction = false

      const recoveredEvents = await Effect.runPromise(
        registry.runReactions().pipe(Effect.provide(runtime.layer)),
      )

      expect(recoveredEvents.map((event) => event.type)).toEqual([
        'greetingSent',
      ])
      expect(recoveredEvents.map((event) => event.payload)).toEqual([
        { name: 'Ada' },
      ])

      const repeatedEvents = await Effect.runPromise(
        registry.runReactions().pipe(Effect.provide(runtime.layer)),
      )

      expect(repeatedEvents).toEqual([])

      failReaction = true

      await expect(
        Effect.runPromise(
          registry
            .dispatch({
              name: 'createThing',
              payload: { name: 'Grace' },
            })
            .pipe(Effect.provide(runtime.layer)),
        ),
      ).rejects.toThrow('reaction failed')

      failReaction = false

      const secondRecoveredEvents = await Effect.runPromise(
        registry.runReactions().pipe(Effect.provide(runtime.layer)),
      )

      expect(secondRecoveredEvents.map((event) => event.type)).toEqual([
        'greetingSent',
      ])
      expect(secondRecoveredEvents.map((event) => event.payload)).toEqual([
        { name: 'Grace' },
      ])
    } finally {
      runtime.cleanup()
    }
  })

  it('initializes custom reaction plugins once and executes payload side effects', async () => {
    const runtime = createTestRuntime()
    const payloads: { kind: string; name: string }[] = []
    let pluginStarts = 0

    try {
      const registry = createRegistry([
        createThingCommand,
        {
          ...greetingReaction('notifyNewThings', (name, exec) =>
            name ? exec({ kind: 'notify', name }) : Effect.succeed(undefined),
          ),
          plugin: () =>
            Effect.sync(() => {
              pluginStarts += 1

              return (payload: { kind: string; name: string }) =>
                Effect.sync(() => {
                  payloads.push(payload)
                })
            }),
        },
      ])

      await Effect.runPromise(
        registry
          .dispatch({ name: 'createThing', payload: { name: 'Ada' } })
          .pipe(Effect.provide(runtime.layer)),
      )
      await Effect.runPromise(
        registry
          .dispatch({ name: 'createThing', payload: { name: 'Grace' } })
          .pipe(Effect.provide(runtime.layer)),
      )

      expect(pluginStarts).toBe(1)
      expect(payloads).toEqual([
        { kind: 'notify', name: 'Ada' },
        { kind: 'notify', name: 'Grace' },
      ])
    } finally {
      runtime.cleanup()
    }
  })

  it('records reaction scenario exec payloads without running plugins', async () => {
    const runtime = createTestRuntime()
    let pluginRan = false

    try {
      const slice = {
        ...greetingReaction('greetScenarioThings', (name, exec) =>
          name
            ? exec({ name: 'sendGreeting', payload: { name } })
            : Effect.succeed(undefined),
        ),
        plugin: () =>
          Effect.sync(() => {
            pluginRan = true

            return () => Effect.succeed(undefined)
          }),
      }

      await expect(
        Effect.runPromise(
          reactToScenario(slice, {
            given: [thingCreated.create({ name: 'Ada' })],
            expect: [{ name: 'sendGreeting', payload: { name: 'Ada' } }],
          }).pipe(Effect.provide(runtime.layer)),
        ),
      ).resolves.toEqual([{ name: 'sendGreeting', payload: { name: 'Ada' } }])
      expect(pluginRan).toBe(false)
    } finally {
      runtime.cleanup()
    }
  })

  it('fails invalid command envelopes with a typed registry error', async () => {
    const runtime = createTestRuntime()

    try {
      const registry = createRegistry([createThingCommand])

      await expect(
        Effect.runPromise(
          registry
            .dispatch({ name: 'createThing', payload: { name: 123 } })
            .pipe(Effect.provide(runtime.layer), Effect.flip),
        ),
      ).resolves.toBeInstanceOf(InvalidCommandError)
    } finally {
      runtime.cleanup()
    }
  })

  it('fails projection registry errors with typed errors', async () => {
    const runtime = createTestRuntime()

    try {
      const registry = createRegistry([
        createThingCommand,
        {
          kind: 'projection',
          name: 'thingByName',
          schema: z.object({ name: z.string() }),
          apply: {},
          query: (_input, query) => Effect.succeed(query),
        },
      ])

      await expect(
        Effect.runPromise(
          registry
            .query('missingProjection', {})
            .pipe(Effect.provide(runtime.layer), Effect.flip),
        ),
      ).resolves.toBeInstanceOf(UnknownProjectionError)
      await expect(
        Effect.runPromise(
          registry
            .query('thingByName', { name: 123 })
            .pipe(Effect.provide(runtime.layer), Effect.flip),
        ),
      ).resolves.toBeInstanceOf(InvalidProjectionInputError)
    } finally {
      runtime.cleanup()
    }
  })

  it('fails duplicate registry names with typed errors', async () => {
    const runtime = createTestRuntime()

    try {
      expect(() =>
        createRegistry([
          createThingCommand,
          {
            ...createThingCommand,
            decide: (payload: unknown) =>
              Effect.succeed([
                thingCreated.create(payload as { name: string }),
              ]),
          },
        ]),
      ).toThrow(DuplicateCommandNameError)
      expect(() =>
        createRegistry([
          createThingCommand,
          {
            kind: 'projection',
            name: 'createThing',
            schema: z.object({}),
            apply: {},
            query: () => Effect.succeed(undefined),
          },
        ]),
      ).toThrow(DuplicateSliceNameError)
    } finally {
      runtime.cleanup()
    }
  })
})

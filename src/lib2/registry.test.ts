import Database from 'better-sqlite3'
import { Effect, Stream } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  createEventSpec,
  createRegistry,
  createRegistryRuntimeLayer,
  InvalidCommandError,
  InvalidProjectionInputError,
  UnknownProjectionError,
} from './index'
import type { JsonSliceSnapshot } from './json-storage'

const thingCreated = createEventSpec(
  'thingCreated',
  z.object({ name: z.string() }),
)
const greetingSent = createEventSpec(
  'greetingSent',
  z.object({ name: z.string() }),
)

type JsonInput = {
  get: <TValue>(key: string) => TValue | undefined
  set: (key: string, value: unknown) => void
}

describe('lib2 registry', () => {
  it('dispatches a command and persists its events', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'specter-registry-'))
    const sqliteFilename = join(directory, 'registry.sqlite')
    const sqlite = new Database(sqliteFilename)
    const snapshots = new Map<string, JsonSliceSnapshot>()
    const jsonStorage = {
      read: (sliceName: string) => structuredClone(snapshots.get(sliceName)),
      write: (sliceName: string, snapshot: JsonSliceSnapshot) => {
        snapshots.set(sliceName, structuredClone(snapshot))
      },
    }

    sqlite.exec(
      'create table events ("order" integer primary key autoincrement, id text not null unique, type text not null, payload text not null, created_at integer not null); create index events_order_idx on events ("order"); create table slice_cursors (slice_name text not null, last_applied_order integer not null);',
    )

    try {
      const registry = createRegistry([
        {
          kind: 'command',
          name: 'createThing',
          schema: z.object({ name: z.string() }),
          decide: (payload) =>
            Effect.succeed([thingCreated.create(payload as { name: string })]),
        },
      ])

      const events = Array.from(
        await Effect.runPromise(
          Stream.runCollect(
            registry.dispatch({
              name: 'createThing',
              payload: { name: 'Ada' },
            }),
          ).pipe(
            Effect.provide(
              createRegistryRuntimeLayer({ sqliteFilename, jsonStorage }),
            ),
          ),
        ),
      )

      expect(events).toEqual([
        expect.objectContaining({
          id: expect.any(String),
          type: 'thingCreated',
          payload: { name: 'Ada' },
        }),
      ])
    } finally {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('catches up a projection before querying', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'specter-registry-'))
    const sqliteFilename = join(directory, 'registry.sqlite')
    const sqlite = new Database(sqliteFilename)
    const snapshots = new Map<string, JsonSliceSnapshot>()
    const jsonStorage = {
      read: (sliceName: string) => structuredClone(snapshots.get(sliceName)),
      write: (sliceName: string, snapshot: JsonSliceSnapshot) => {
        snapshots.set(sliceName, structuredClone(snapshot))
      },
    }

    sqlite.exec(
      'create table events ("order" integer primary key autoincrement, id text not null unique, type text not null, payload text not null, created_at integer not null); create index events_order_idx on events ("order"); create table slice_cursors (slice_name text not null, last_applied_order integer not null);',
    )

    try {
      const registry = createRegistry([
        {
          kind: 'command',
          name: 'createThing',
          schema: z.object({ name: z.string() }),
          decide: (payload) =>
            Effect.succeed([thingCreated.create(payload as { name: string })]),
        },
        {
          kind: 'projection',
          name: 'thingNames',
          json: true,
          schema: z.object({}),
          apply: {
            thingCreated: (event, input) =>
              Effect.sync(() => {
                const state = input as unknown as JsonInput
                state.set('names', [
                  ...(state.get<string[]>('names') ?? []),
                  (event.payload as { name: string }).name,
                ])
              }),
          },
          query: (input) =>
            Effect.succeed((input as unknown as JsonInput).get('names') ?? []),
        },
      ])

      const layer = createRegistryRuntimeLayer({ sqliteFilename, jsonStorage })

      await Effect.runPromise(
        Stream.runDrain(
          registry.dispatch({ name: 'createThing', payload: { name: 'Ada' } }),
        ).pipe(Effect.provide(layer)),
      )

      await expect(
        Effect.runPromise(
          registry.query('thingNames', {}).pipe(Effect.provide(layer)),
        ),
      ).resolves.toEqual(['Ada'])
    } finally {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('streams commands returned by reactions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'specter-registry-'))
    const sqliteFilename = join(directory, 'registry.sqlite')
    const sqlite = new Database(sqliteFilename)
    const snapshots = new Map<string, JsonSliceSnapshot>()
    const jsonStorage = {
      read: (sliceName: string) => structuredClone(snapshots.get(sliceName)),
      write: (sliceName: string, snapshot: JsonSliceSnapshot) => {
        snapshots.set(sliceName, structuredClone(snapshot))
      },
    }

    sqlite.exec(
      'create table events ("order" integer primary key autoincrement, id text not null unique, type text not null, payload text not null, created_at integer not null); create index events_order_idx on events ("order"); create table slice_cursors (slice_name text not null, last_applied_order integer not null);',
    )

    try {
      const registry = createRegistry([
        {
          kind: 'command',
          name: 'createThing',
          schema: z.object({ name: z.string() }),
          decide: (payload) =>
            Effect.succeed([thingCreated.create(payload as { name: string })]),
        },
        {
          kind: 'command',
          name: 'sendGreeting',
          schema: z.object({ name: z.string() }),
          decide: (payload) =>
            Effect.succeed([greetingSent.create(payload as { name: string })]),
        },
        {
          kind: 'reaction',
          name: 'greetNewThings',
          json: true,
          apply: {
            thingCreated: (event, input) =>
              Effect.sync(() => {
                ;(input as unknown as JsonInput).set(
                  'name',
                  (event.payload as { name: string }).name,
                )
              }),
          },
          react: (input) =>
            Effect.succeed([
              {
                name: 'sendGreeting',
                payload: {
                  name: (input as unknown as JsonInput).get('name'),
                },
              },
            ]),
        },
      ])

      const events = Array.from(
        await Effect.runPromise(
          Stream.runCollect(
            registry.dispatch({
              name: 'createThing',
              payload: { name: 'Ada' },
            }),
          ).pipe(
            Effect.provide(
              createRegistryRuntimeLayer({ sqliteFilename, jsonStorage }),
            ),
          ),
        ),
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
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('resumes failed reactions from their last successful cursor', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'specter-registry-'))
    const sqliteFilename = join(directory, 'registry.sqlite')
    const sqlite = new Database(sqliteFilename)
    const snapshots = new Map<string, JsonSliceSnapshot>()
    const jsonStorage = {
      read: (sliceName: string) => structuredClone(snapshots.get(sliceName)),
      write: (sliceName: string, snapshot: JsonSliceSnapshot) => {
        snapshots.set(sliceName, structuredClone(snapshot))
      },
    }
    let failReaction = true

    sqlite.exec(
      'create table events ("order" integer primary key autoincrement, id text not null unique, type text not null, payload text not null, created_at integer not null); create index events_order_idx on events ("order"); create table slice_cursors (slice_name text not null, last_applied_order integer not null);',
    )

    try {
      const registry = createRegistry([
        {
          kind: 'command',
          name: 'createThing',
          schema: z.object({ name: z.string() }),
          decide: (payload) =>
            Effect.succeed([thingCreated.create(payload as { name: string })]),
        },
        {
          kind: 'command',
          name: 'sendGreeting',
          schema: z.object({ name: z.string() }),
          decide: (payload) =>
            Effect.succeed([greetingSent.create(payload as { name: string })]),
        },
        {
          kind: 'reaction',
          name: 'greetNewThings',
          json: true,
          apply: {
            thingCreated: (event, input) =>
              Effect.sync(() => {
                ;(input as unknown as JsonInput).set(
                  'name',
                  (event.payload as { name: string }).name,
                )
              }),
          },
          react: (input) =>
            Effect.sync(() => {
              if (failReaction) {
                throw new Error('reaction failed')
              }

              return [
                {
                  name: 'sendGreeting',
                  payload: {
                    name: (input as unknown as JsonInput).get('name'),
                  },
                },
              ]
            }),
        },
      ])
      const layer = createRegistryRuntimeLayer({ sqliteFilename, jsonStorage })

      await expect(
        Effect.runPromise(
          Stream.runDrain(
            registry.dispatch({
              name: 'createThing',
              payload: { name: 'Ada' },
            }),
          ).pipe(Effect.provide(layer)),
        ),
      ).rejects.toThrow('reaction failed')

      failReaction = false

      const recoveredEvents = Array.from(
        await Effect.runPromise(
          Stream.runCollect(registry.runReactions()).pipe(
            Effect.provide(layer),
          ),
        ),
      )

      expect(recoveredEvents.map((event) => event.type)).toEqual([
        'greetingSent',
      ])
      expect(recoveredEvents.map((event) => event.payload)).toEqual([
        { name: 'Ada' },
      ])

      const repeatedEvents = Array.from(
        await Effect.runPromise(
          Stream.runCollect(registry.runReactions()).pipe(
            Effect.provide(layer),
          ),
        ),
      )

      expect(repeatedEvents).toEqual([])

      failReaction = true

      await expect(
        Effect.runPromise(
          Stream.runDrain(
            registry.dispatch({
              name: 'createThing',
              payload: { name: 'Grace' },
            }),
          ).pipe(Effect.provide(layer)),
        ),
      ).rejects.toThrow('reaction failed')

      expect(snapshots.get('greetNewThings')).toEqual({
        lastAppliedOrder: 1,
        state: { name: 'Ada' },
      })

      failReaction = false

      const secondRecoveredEvents = Array.from(
        await Effect.runPromise(
          Stream.runCollect(registry.runReactions()).pipe(
            Effect.provide(layer),
          ),
        ),
      )

      expect(secondRecoveredEvents.map((event) => event.type)).toEqual([
        'greetingSent',
      ])
      expect(secondRecoveredEvents.map((event) => event.payload)).toEqual([
        { name: 'Grace' },
      ])
    } finally {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('fails invalid command envelopes with a typed registry error', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'specter-registry-'))
    const sqliteFilename = join(directory, 'registry.sqlite')
    const sqlite = new Database(sqliteFilename)
    const snapshots = new Map<string, JsonSliceSnapshot>()
    const jsonStorage = {
      read: (sliceName: string) => structuredClone(snapshots.get(sliceName)),
      write: (sliceName: string, snapshot: JsonSliceSnapshot) => {
        snapshots.set(sliceName, structuredClone(snapshot))
      },
    }

    sqlite.exec(
      'create table events ("order" integer primary key autoincrement, id text not null unique, type text not null, payload text not null, created_at integer not null); create index events_order_idx on events ("order"); create table slice_cursors (slice_name text not null, last_applied_order integer not null);',
    )

    try {
      const registry = createRegistry([
        {
          kind: 'command',
          name: 'createThing',
          schema: z.object({ name: z.string() }),
          decide: (payload) =>
            Effect.succeed([thingCreated.create(payload as { name: string })]),
        },
      ])

      await expect(
        Effect.runPromise(
          Stream.runDrain(
            registry.dispatch({ name: 'createThing', payload: { name: 123 } }),
          ).pipe(
            Effect.provide(
              createRegistryRuntimeLayer({ sqliteFilename, jsonStorage }),
            ),
            Effect.flip,
          ),
        ),
      ).resolves.toBeInstanceOf(InvalidCommandError)
    } finally {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('fails projection registry errors with typed errors', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'specter-registry-'))
    const sqliteFilename = join(directory, 'registry.sqlite')
    const sqlite = new Database(sqliteFilename)
    const snapshots = new Map<string, JsonSliceSnapshot>()
    const jsonStorage = {
      read: (sliceName: string) => structuredClone(snapshots.get(sliceName)),
      write: (sliceName: string, snapshot: JsonSliceSnapshot) => {
        snapshots.set(sliceName, structuredClone(snapshot))
      },
    }

    sqlite.exec(
      'create table events ("order" integer primary key autoincrement, id text not null unique, type text not null, payload text not null, created_at integer not null); create index events_order_idx on events ("order"); create table slice_cursors (slice_name text not null, last_applied_order integer not null);',
    )

    try {
      const registry = createRegistry([
        {
          kind: 'command',
          name: 'createThing',
          schema: z.object({ name: z.string() }),
          decide: (payload) =>
            Effect.succeed([thingCreated.create(payload as { name: string })]),
        },
        {
          kind: 'projection',
          name: 'thingByName',
          json: true,
          schema: z.object({ name: z.string() }),
          apply: {},
          query: (_input, query) => Effect.succeed(query),
        },
      ])
      const layer = createRegistryRuntimeLayer({ sqliteFilename, jsonStorage })

      await expect(
        Effect.runPromise(
          registry
            .query('missingProjection', {})
            .pipe(Effect.provide(layer), Effect.flip),
        ),
      ).resolves.toBeInstanceOf(UnknownProjectionError)
      await expect(
        Effect.runPromise(
          registry
            .query('thingByName', { name: 123 })
            .pipe(Effect.provide(layer), Effect.flip),
        ),
      ).resolves.toBeInstanceOf(InvalidProjectionInputError)
    } finally {
      sqlite.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

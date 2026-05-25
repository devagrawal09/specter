import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Effect } from 'effect'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

import {
  createCommandSlice,
  createProjectionSlice,
  createReactionSlice,
} from './builders'
import { createEventDefinition } from './event'
import { createSpecterAppRuntimeLayer } from './layers'
import { EventLogService } from './services'
import type { SpecterAppServices } from './slice'
import {
  createSpecterApp,
  InvalidEventDraftError,
  ReactionRunError,
  UnknownEventTypeError,
} from './registry'

const observedEvent = createEventDefinition(
  'observed',
  Schema.Struct({ value: Schema.String }),
)

it('rejects slice apply keys that are not registered event definitions', () => {
  const command = createCommandSlice('noop')
    .schema(Schema.Struct({}))
    .handle(() => [])
  const projection = createProjectionSlice('badProjection')
    .schema(Schema.Struct({}))
    .apply({ missingEvent: () => Effect.void })
    .handle(() => [])

  const result = Effect.runSync(
    createSpecterApp({
      events: [observedEvent],
      slices: [command, projection],
    }).pipe(Effect.either),
  )

  expect(Either.isLeft(result)).toBe(true)
  if (!Either.isLeft(result)) {
    throw new Error('App creation unexpectedly succeeded')
  }
  expect(result.left).toBeInstanceOf(UnknownEventTypeError)
  expect(result.left).toMatchObject({ eventType: 'missingEvent' })
})

it('validates known emitted event drafts before append', async () => {
  const command = createCommandSlice('emitInvalid')
    .schema(Schema.Struct({}))
    .handle(() => [{ type: observedEvent.type, payload: {} }])
  const app = Effect.runSync(
    createSpecterApp({ events: [observedEvent], slices: [command] }),
  )

  const result = await runWithTestDb(
    Effect.gen(function* () {
      const dispatchResult = yield* app
        .dispatch({ type: 'emitInvalid', payload: {} })
        .pipe(Effect.either)
      const eventLog = yield* EventLogService
      const persistedEvents = yield* eventLog.readAfter(0, [observedEvent.type])

      return { dispatchResult, persistedEvents }
    }),
  )

  expect(Either.isLeft(result.dispatchResult)).toBe(true)
  if (!Either.isLeft(result.dispatchResult)) {
    throw new Error('Command unexpectedly succeeded')
  }
  expect(result.dispatchResult.left).toBeInstanceOf(InvalidEventDraftError)
  expect(result.persistedEvents).toEqual([])
})

it('aggregates reaction catch-up and handle failures while continuing others', async () => {
  const command = createCommandSlice('noop')
    .schema(Schema.Struct({}))
    .handle(() => [])
  const ranEffects: string[] = []
  const failingReaction = createReactionSlice('failingReaction')
    .apply({
      [observedEvent.type]: () => Effect.void,
    })
    .handle(() => Effect.fail('handle failed'))
  const continuingReaction = createReactionSlice('continuingReaction')
    .plugin(() =>
      Effect.succeed(() =>
        Effect.sync(() => {
          ranEffects.push('continuingReaction')
        }),
      ),
    )
    .apply({
      [observedEvent.type]: () => Effect.void,
    })
    .handle(() => ({ type: 'noop', payload: {} }))
  const app = Effect.runSync(
    createSpecterApp({
      events: [observedEvent],
      slices: [command, failingReaction, continuingReaction],
    }),
  )

  const result = await runWithTestDb(
    Effect.gen(function* () {
      const eventLog = yield* EventLogService
      yield* eventLog.append([observedEvent.create({ value: 'seen' })])
      return yield* app.runReactions().pipe(Effect.either)
    }),
  )

  expect(Either.isLeft(result)).toBe(true)
  if (!Either.isLeft(result)) {
    throw new Error('Reactions unexpectedly succeeded')
  }
  expect(result.left).toBeInstanceOf(ReactionRunError)
  expect(result.left).toMatchObject({
    failures: [{ reactionName: 'failingReaction', cause: 'handle failed' }],
  })
  expect(ranEffects).toEqual(['continuingReaction'])
})

async function runWithTestDb<T>(
  effect: Effect.Effect<T, unknown, SpecterAppServices>,
) {
  const directory = mkdtempSync(join(tmpdir(), 'specter-lib-'))
  const sqliteFilename = join(directory, 'test.sqlite')
  const sqlite = new Database(sqliteFilename)

  try {
    try {
      const db = drizzle(sqlite)
      migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') })
    } finally {
      sqlite.close()
    }

    return await Effect.runPromise(
      effect.pipe(
        Effect.provide(createSpecterAppRuntimeLayer({ sqliteFilename })),
      ),
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

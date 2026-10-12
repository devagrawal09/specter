import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createEventDefinition,
  createSpecterApp,
  EventLog,
  EventLogFailure,
  implementCommand,
  SpecterVersionConflictError,
  type SliceStoreService,
} from '@specter-ts/core'
import {
  eventLogConformance,
  sliceStoreConformance,
} from '@specter-ts/core/testing'
import {
  type ReactionOutboxConformancePayload,
  reactionOutboxStoreConformance,
} from '@specter-ts/reaction-outbox/testing'
import { createCommandSlice, event } from '@specter-ts/spec'
import { Context, Effect, Layer } from 'effect'

import type {
  PostgresPool,
  PostgresPoolClient,
  PostgresQueryResult,
} from './database'
import { createPostgresDatabaseContext } from './database'
import {
  createPostgresEventLogService,
  postgresEventLogMigrations,
} from './event-log'
import {
  migrateSpecterPostgres,
  type PostgresMigration,
  PostgresMigrationFailure,
} from './migrations'
import { specterPostgresMigrations } from './persistence'
import { createPostgresReactionOutboxStore } from './reaction-outbox'
import { createPostgresSliceStoreService } from './slice-store'

const databaseUrl = process.env.SPECTER_POSTGRES_URL

const run = Effect.runPromise

function queryable(connection: Pool | PoolClient): Pick<PostgresPool, 'query'> {
  return {
    async query<TRow extends object = Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<PostgresQueryResult<TRow>> {
      const result = await connection.query(sql, [...parameters])
      return {
        rows: result.rows as TRow[],
        rowCount: result.rowCount ?? undefined,
      }
    },
  }
}

function adaptClient(client: PoolClient): PostgresPoolClient {
  return {
    ...queryable(client),
    release: () => client.release(),
  }
}

function adaptPool(pool: Pool): PostgresPool {
  return {
    ...queryable(pool),
    connect: async () => adaptClient(await pool.connect()),
  }
}

describe.skipIf(!databaseUrl)('Postgres adapters against a real server', () => {
  const nativePool = new Pool({ connectionString: databaseUrl })
  const pool = adaptPool(nativePool)

  beforeAll(async () => {
    await nativePool.query('SELECT 1')
  })

  beforeEach(async () => {
    await nativePool.query(`
      DROP TABLE IF EXISTS project_state;
      DROP TABLE IF EXISTS specter_reaction_outbox;
      DROP TABLE IF EXISTS specter_slice_states;
      DROP TABLE IF EXISTS specter_event_commits;
      DROP TABLE IF EXISTS specter_event_keys;
      DROP TABLE IF EXISTS specter_event_purges;
      DROP TABLE IF EXISTS specter_events;
      DROP TABLE IF EXISTS specter_migrations;
    `)
    await migrateSpecterPostgres(pool, specterPostgresMigrations)
  })

  afterAll(async () => {
    await nativePool.end()
  })

  it('applies each migration once, records it, and refuses a newer database or tables it did not create', async () => {
    const recorded = async () =>
      (
        await nativePool.query(
          'SELECT store, version FROM specter_migrations ORDER BY store, version',
        )
      ).rows.map((row) => `${row.store}@${row.version}`)
    expect(await recorded()).toEqual([
      'event-log@1',
      'reaction-outbox@1',
      'slice-store@1',
    ])
    // A second run, or a second process, finds nothing to do.
    expect(
      await migrateSpecterPostgres(pool, specterPostgresMigrations),
    ).toEqual([])
    // A later release's migration of the Event Log, for this test only.
    const version2: PostgresMigration = {
      store: 'event-log',
      version: 2,
      description: 'Events by recorded time',
      statements: [
        'CREATE INDEX specter_events_recorded_idx ON specter_events(recorded_at)',
      ],
    }
    expect(
      await migrateSpecterPostgres(pool, [
        ...postgresEventLogMigrations,
        version2,
      ]),
    ).toEqual([version2])
    expect(await recorded()).toContain('event-log@2')
    await expect(
      migrateSpecterPostgres(pool, postgresEventLogMigrations),
    ).rejects.toThrow(PostgresMigrationFailure)
    // Tables from before the migrations fail the run, which leaves nothing.
    await nativePool.query('DROP TABLE specter_migrations')
    await expect(
      migrateSpecterPostgres(pool, specterPostgresMigrations),
    ).rejects.toThrow("event-log store's migration 1")
    expect(
      (
        await nativePool.query(
          "SELECT to_regclass('specter_migrations') AS migrations",
        )
      ).rows[0]?.migrations,
    ).toBe(null)
  })

  it('conforms to the Event Log contract, keys and keyed reads included', async () => {
    await run(
      eventLogConformance(Effect.succeed(createPostgresEventLogService(pool))),
    )
  })

  it('conforms to the Slice Store contract, versions included', async () => {
    await run(
      sliceStoreConformance({
        createService: Effect.succeed(
          createPostgresSliceStoreService(pool, () => ({ value: 0 })),
        ),
        write: async (state, value: number) => {
          state.value = value
        },
        read: async (state) => state.value,
        value: 42,
      }),
    )
  })

  it('conforms to the Reaction outbox Store contract', async () => {
    await run(
      reactionOutboxStoreConformance(
        Effect.succeed(
          createPostgresReactionOutboxStore<ReactionOutboxConformancePayload>(
            pool,
          ),
        ),
      ),
    )
  })

  it('serializes cross-context appends with an advisory lock and real rollback', async () => {
    let eventNumber = 0
    const options = {
      eventId: () => `event-${++eventNumber}`,
      now: () => new Date('2026-07-16T12:00:00.000Z'),
    }
    const firstLog = createPostgresEventLogService(pool, options)
    const secondLog = createPostgresEventLogService(pool, options)

    const results = await Promise.allSettled([
      run(
        firstLog.append(
          [{ type: 'created', payload: { writer: 'first' }, keys: {} }],
          {
            expectedVersion: 0,
          },
        ),
      ),
      run(
        secondLog.append(
          [{ type: 'created', payload: { writer: 'second' }, keys: {} }],
          {
            expectedVersion: 0,
          },
        ),
      ),
    ])

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({
        cause: expect.any(SpecterVersionConflictError),
      }),
    })
    expect(await run(firstLog.currentVersion)).toBe(1)

    const idempotent = await Promise.all([
      run(
        firstLog.append(
          [{ type: 'requested', payload: { requestId: 'one' }, keys: {} }],
          {
            expectedVersion: 1,
            idempotencyKey: 'request-one',
            fingerprint: 'same-command',
          },
        ),
      ),
      run(
        secondLog.append(
          [{ type: 'requested', payload: { requestId: 'one' }, keys: {} }],
          {
            expectedVersion: 1,
            idempotencyKey: 'request-one',
            fingerprint: 'changed-command',
          },
        ),
      ),
    ])
    expect(idempotent.map((commit) => commit.duplicate).sort()).toEqual([
      false,
      true,
    ])
    expect(idempotent[0]?.version).toBe(idempotent[1]?.version)
    expect(idempotent[0]?.fingerprint).toBe(idempotent[1]?.fingerprint)
    expect(await run(firstLog.currentVersion)).toBe(2)

    const context = createPostgresDatabaseContext(pool)
    await expect(
      run(
        context.transaction((connection) =>
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              connection.query(
                'INSERT INTO specter_events (id, type, payload, recorded_at) VALUES ($1, $2, $3::jsonb, $4)',
                ['rolled-back', 'rolled-back', '{}', new Date()],
              ),
            )
            return yield* Effect.fail(new Error('rollback probe'))
          }),
        ),
      ),
    ).rejects.toThrow('rollback probe')
    expect(await run(firstLog.currentVersion)).toBe(2)
  })

  it('keeps staged Slice publication independent from a conflicting Event append', async () => {
    let eventNumber = 0
    const commandLog = createPostgresEventLogService(pool, {
      eventId: () => `command-event-${++eventNumber}`,
    })
    const competingLog = createPostgresEventLogService(pool, {
      eventId: () => 'competing-event',
    })
    const store = createPostgresSliceStoreService(pool, () => ({ count: 0 }))
    class CounterStore extends Context.Service<
      CounterStore,
      SliceStoreService<Readonly<{ count: number }>, { count: number }, unknown>
    >()('postgres-integration/CounterStore') {}
    const counterIncremented = createEventDefinition('counter-incremented', {
      '~standard': {
        version: 1,
        vendor: 'specter-postgres-integration-test',
        validate: (value: unknown) => ({
          value: value as { amount: number },
        }),
      },
    })

    await run(
      commandLog.append([
        { ...counterIncremented.create({ amount: 1 }), keys: {} },
      ]),
    )

    const incrementCounterSpecification = createCommandSlice('incrementCounter')
      .description('Increments a counter after reading its Event projection.')
      .scenarios({
        description: 'Increments an existing counter.',
        given: [event('counter-incremented', { amount: 1 })],
        when: { amount: 9 },
        expect: [event('counter-incremented', { amount: 9 })],
      })
    const incrementCounter = implementCommand(
      JSON.stringify(incrementCounterSpecification),
    )
      .inputSchema<{ amount: number }>()
      .store(CounterStore)
      .apply(counterIncremented, async (persisted, state) => {
        state.count += persisted.payload.amount
      })
      .handle(async (input, state) => {
        expect(state.count).toBe(1)
        await run(
          competingLog.append([
            {
              type: 'competing-event',
              payload: { count: state.count },
              keys: {},
            },
          ]),
        )
        return [counterIncremented.create(input)]
      })
    const app = await createSpecterApp(
      {
        events: [counterIncremented],
        slices: { incrementCounter },
      },
      Layer.mergeAll(
        Layer.succeed(EventLog, commandLog),
        Layer.succeed(CounterStore, store),
      ),
    )

    // A caller's expectedVersion is a whole-log check, so the competing
    // writer's Event, of a type the Command does not apply, makes it stale.
    await expect(
      app.command(
        { type: 'incrementCounter', payload: { amount: 9 } },
        { expectedVersion: 1 },
      ),
    ).rejects.toBeInstanceOf(EventLogFailure)

    const published = await run(
      store.read(
        {
          name: 'incrementCounter',
          version: `${incrementCounter.specificationDigest}/${incrementCounter.stateVersion}`,
        },
        (state, cursor) => Effect.succeed({ state, cursor }),
      ),
    )
    expect(published.state).toEqual({ count: 1 })
    expect(published.cursor).toBe(1)
    expect(await run(commandLog.currentVersion)).toBe(2)
  })

  it('preserves top-level JSON-compatible values across real JSONB columns', async () => {
    const values = ['null', '123', 'true', null, 123, true] as const
    let eventNumber = 0
    const eventLog = createPostgresEventLogService(pool, {
      eventId: () => `primitive-event-${++eventNumber}`,
      now: () => new Date(0),
    })

    await run(
      eventLog.append(
        values.map((value) => ({
          type: 'value-recorded',
          payload: value,
          keys: {},
        })),
      ),
    )
    expect(
      (await run(eventLog.query(0, ['value-recorded']))).map(
        (persisted) => persisted.payload,
      ),
    ).toEqual(values)

    for (const [index, value] of values.entries()) {
      const store = createPostgresSliceStoreService(pool, () => value)
      const sliceName = `primitive${index}`
      await run(
        store.transaction(
          { name: sliceName, version: 'v1' },
          (_write, _read, _cursor, publishCursor) => publishCursor(index + 1),
        ),
      )
      const persisted = await run(
        store.read({ name: sliceName, version: 'v1' }, (state, cursor) =>
          Effect.succeed({ state, cursor }),
        ),
      )
      expect(persisted.state).toBe(value)
      expect(persisted.cursor).toBe(index + 1)
    }

    const outbox = createPostgresReactionOutboxStore<unknown>(pool)
    for (const [index, value] of values.entries()) {
      const id = `primitive-job-${index}`
      await run(
        outbox.enqueue({
          id,
          idempotencyKey: `primitive-delivery-${index}`,
          payload: value,
          requestedAt: new Date(0),
          availableAt: new Date(0),
        }),
      )
      expect((await run(outbox.get(id)))?.payload).toBe(value)
    }
  })

  it('round-trips JSONB and atomically claims, retries, dead-letters, and replays outbox work', async () => {
    type Payload = { message: string; nested: { attempt: number } }
    const firstWorker = createPostgresReactionOutboxStore<Payload>(pool)
    const secondWorker = createPostgresReactionOutboxStore<Payload>(pool)
    const now = new Date('2026-07-16T12:00:00.000Z')
    await run(
      firstWorker.enqueue({
        id: 'job-1',
        idempotencyKey: 'delivery-1',
        payload: { message: 'hello', nested: { attempt: 0 } },
        requestedAt: now,
        availableAt: now,
      }),
    )

    const claims = await Promise.all([
      run(firstWorker.claimNext(now, new Date(now.getTime() + 10_000))),
      run(secondWorker.claimNext(now, new Date(now.getTime() + 10_000))),
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const firstClaim = claims.find(
      (claim): claim is NonNullable<typeof claim> => claim !== undefined,
    )
    expect(firstClaim).toMatchObject({
      payload: { message: 'hello', nested: { attempt: 0 } },
      attemptCount: 1,
    })
    if (!firstClaim) throw new Error('expected a first outbox claim')

    await run(
      firstWorker.reschedule(
        firstClaim.id,
        firstClaim.activeAttemptId,
        now,
        'temporary outage',
      ),
    )
    const secondClaim = await run(
      secondWorker.claimNext(now, new Date(now.getTime() + 10_000)),
    )
    expect(secondClaim).toMatchObject({ attemptCount: 2 })
    if (!secondClaim) throw new Error('expected a second outbox claim')
    await run(
      secondWorker.deadLetter(
        secondClaim.id,
        secondClaim.activeAttemptId,
        now,
        'permanent outage',
      ),
    )
    await run(firstWorker.retryDeadLetter('job-1', now))

    const replay = await run(
      firstWorker.claimNext(now, new Date(now.getTime() + 10_000)),
    )
    expect(replay).toMatchObject({ attemptCount: 3 })
    if (!replay) throw new Error('expected a replayed outbox claim')
    await run(firstWorker.complete(replay.id, replay.activeAttemptId, now))
    expect(await run(firstWorker.get('job-1'))).toMatchObject({
      status: 'completed',
      attemptCount: 3,
      lastError: undefined,
    })
  })
})

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
  preparePostgresEventLog,
} from './event-log'
import {
  createPostgresReactionOutboxStore,
  preparePostgresReactionOutbox,
} from './reaction-outbox'
import {
  createPostgresSliceStoreService,
  preparePostgresSliceStore,
} from './slice-store'

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
      DROP TABLE IF EXISTS specter_events;
    `)
    await preparePostgresEventLog(pool)
    await preparePostgresSliceStore(pool)
    await preparePostgresReactionOutbox(pool)
  })

  afterAll(async () => {
    await nativePool.end()
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
        firstLog.append([{ type: 'created', payload: { writer: 'first' } }], {
          expectedVersion: 0,
        }),
      ),
      run(
        secondLog.append([{ type: 'created', payload: { writer: 'second' } }], {
          expectedVersion: 0,
        }),
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
          [{ type: 'requested', payload: { requestId: 'one' } }],
          {
            expectedVersion: 1,
            idempotencyKey: 'request-one',
            fingerprint: 'same-command',
          },
        ),
      ),
      run(
        secondLog.append(
          [{ type: 'requested', payload: { requestId: 'one' } }],
          {
            expectedVersion: 1,
            idempotencyKey: 'request-one',
            fingerprint: 'same-command',
          },
        ),
      ),
    ])
    expect(idempotent.map((commit) => commit.duplicate).sort()).toEqual([
      false,
      true,
    ])
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

    await run(commandLog.append([counterIncremented.create({ amount: 1 })]))

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
            { type: 'competing-event', payload: { count: state.count } },
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

    await expect(
      app.command({ type: 'incrementCounter', payload: { amount: 9 } }),
    ).rejects.toBeInstanceOf(EventLogFailure)

    const published = await run(
      store.read('incrementCounter', (state, cursor) =>
        Effect.succeed({ state, cursor }),
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
        values.map((value) => ({ type: 'value-recorded', payload: value })),
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
        store.transaction(sliceName, (_write, _read, _cursor, publishCursor) =>
          publishCursor(index + 1),
        ),
      )
      const persisted = await run(
        store.read(sliceName, (state, cursor) =>
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

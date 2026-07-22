import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createEventDefinition,
  createSpecterApp,
  implementCommand,
  SpecterVersionConflictError,
  type ReactionScheduler,
} from '@specter-ts/core'
import { createCommandSlice, event } from '@specter-ts/spec'

import type {
  PostgresPool,
  PostgresPoolClient,
  PostgresQueryResult,
} from './database'
import { createPostgresDatabaseContext } from './database'
import { createPostgresEventLog, preparePostgresEventLog } from './event-log'
import {
  createPostgresReactionOutboxStore,
  preparePostgresReactionOutbox,
} from './reaction-outbox'
import {
  createPostgresSliceStore,
  preparePostgresSliceStore,
} from './slice-store'

const databaseUrl = process.env.SPECTER_POSTGRES_URL

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
    const firstLog = createPostgresEventLog(pool, options)
    const secondLog = createPostgresEventLog(pool, options)

    const results = await Promise.allSettled([
      firstLog.append([{ type: 'created', payload: { writer: 'first' } }], {
        expectedVersion: 0,
      }),
      secondLog.append([{ type: 'created', payload: { writer: 'second' } }], {
        expectedVersion: 0,
      }),
    ])

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({
      reason: expect.any(SpecterVersionConflictError),
    })
    expect(await firstLog.currentVersion()).toBe(1)

    const idempotent = await Promise.all([
      firstLog.append([{ type: 'requested', payload: { requestId: 'one' } }], {
        expectedVersion: 1,
        idempotencyKey: 'request-one',
        fingerprint: 'same-command',
      }),
      secondLog.append([{ type: 'requested', payload: { requestId: 'one' } }], {
        expectedVersion: 1,
        idempotencyKey: 'request-one',
        fingerprint: 'same-command',
      }),
    ])
    expect(idempotent.map((commit) => commit.duplicate).sort()).toEqual([
      false,
      true,
    ])
    expect(await firstLog.currentVersion()).toBe(2)

    const context = createPostgresDatabaseContext(pool)
    await expect(
      context.transaction(async (connection) => {
        await connection.query(
          'INSERT INTO specter_events (id, type, payload, recorded_at) VALUES ($1, $2, $3::jsonb, $4)',
          ['rolled-back', 'rolled-back', '{}', new Date()],
        )
        throw new Error('rollback probe')
      }),
    ).rejects.toThrow('rollback probe')
    expect(await firstLog.currentVersion()).toBe(2)
  })

  it('keeps staged Slice publication independent from a conflicting Event append', async () => {
    let eventNumber = 0
    const commandLog = createPostgresEventLog(pool, {
      eventId: () => `command-event-${++eventNumber}`,
    })
    const competingLog = createPostgresEventLog(pool, {
      eventId: () => 'competing-event',
    })
    const store = createPostgresSliceStore(pool, () => ({ count: 0 }))
    const counterIncremented = createEventDefinition('counter-incremented', {
      '~standard': {
        version: 1,
        vendor: 'specter-postgres-integration-test',
        validate: (value: unknown) => ({
          value: value as { amount: number },
        }),
      },
    })

    await commandLog.append([counterIncremented.create({ amount: 1 })])

    const incrementCounterSpec = createCommandSlice('incrementCounter')
      .description('Increments a counter after reading its Event projection.')
      .scenarios({
        description: 'Increments an existing counter.',
        given: [event('counter-incremented', { amount: 1 })],
        when: { amount: 9 },
        expect: [event('counter-incremented', { amount: 9 })],
      })
    const incrementCounter = implementCommand<'incrementCounter'>(
      JSON.stringify(incrementCounterSpec),
    )
      .inputSchema<{ amount: number }>()
      .store(store)
      .apply(counterIncremented, async (persisted, state) => {
        state.count += persisted.payload.amount
      })
      .handle(async (input, state) => {
        expect(state.count).toBe(1)
        await competingLog.append([
          { type: 'competing-event', payload: { count: state.count } },
        ])
        return [counterIncremented.create(input)]
      })
    const schedule: ReactionScheduler = () => () => () => Promise.resolve()
    const app = await createSpecterApp({
      events: [counterIncremented],
      eventLog: commandLog,
      schedule,
      slices: [incrementCounter],
    })

    await expect(
      app.command({ type: 'incrementCounter', payload: { amount: 9 } }),
    ).rejects.toBeInstanceOf(SpecterVersionConflictError)

    const published = await store.get('incrementCounter')
    expect(published.read).toEqual({ count: 1 })
    expect(await published.lastAppliedOrder()).toBe(1)
    expect(await commandLog.currentVersion()).toBe(2)
  })

  it('preserves top-level JSON-compatible values across real JSONB columns', async () => {
    const values = ['null', '123', 'true', null, 123, true] as const
    let eventNumber = 0
    const eventLog = createPostgresEventLog(pool, {
      eventId: () => `primitive-event-${++eventNumber}`,
      now: () => new Date(0),
    })

    await eventLog.append(
      values.map((value) => ({ type: 'value-recorded', payload: value })),
    )
    expect(
      (await eventLog.query(0, ['value-recorded'])).map(
        (persisted) => persisted.payload,
      ),
    ).toEqual(values)

    for (const [index, value] of values.entries()) {
      const store = createPostgresSliceStore(pool, () => value)
      const sliceName = `primitive${index}`
      const staged = await store.get(sliceName)
      await staged.setLastAppliedOrder(index + 1)
      const persisted = await store.get(sliceName)
      expect(persisted.read).toBe(value)
      expect(await persisted.lastAppliedOrder()).toBe(index + 1)
    }

    const outbox = createPostgresReactionOutboxStore<unknown>(pool)
    for (const [index, value] of values.entries()) {
      const id = `primitive-job-${index}`
      await outbox.enqueue({
        id,
        idempotencyKey: `primitive-delivery-${index}`,
        payload: value,
        requestedAt: new Date(0),
        availableAt: new Date(0),
      })
      expect((await outbox.get(id))?.payload).toBe(value)
    }
  })

  it('round-trips JSONB and atomically claims, retries, dead-letters, and replays outbox work', async () => {
    type Payload = { message: string; nested: { attempt: number } }
    const firstWorker = createPostgresReactionOutboxStore<Payload>(pool)
    const secondWorker = createPostgresReactionOutboxStore<Payload>(pool)
    const now = new Date('2026-07-16T12:00:00.000Z')
    await firstWorker.enqueue({
      id: 'job-1',
      idempotencyKey: 'delivery-1',
      payload: { message: 'hello', nested: { attempt: 0 } },
      requestedAt: now,
      availableAt: now,
    })

    const claims = await Promise.all([
      firstWorker.claimNext(now, new Date(now.getTime() + 10_000)),
      secondWorker.claimNext(now, new Date(now.getTime() + 10_000)),
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

    await firstWorker.reschedule(
      firstClaim.id,
      firstClaim.activeAttemptId,
      now,
      'temporary outage',
    )
    const secondClaim = await secondWorker.claimNext(
      now,
      new Date(now.getTime() + 10_000),
    )
    expect(secondClaim).toMatchObject({ attemptCount: 2 })
    if (!secondClaim) throw new Error('expected a second outbox claim')
    await secondWorker.deadLetter(
      secondClaim.id,
      secondClaim.activeAttemptId,
      now,
      'permanent outage',
    )
    await firstWorker.retryDeadLetter('job-1', now)

    const replay = await firstWorker.claimNext(
      now,
      new Date(now.getTime() + 10_000),
    )
    expect(replay).toMatchObject({ attemptCount: 3 })
    if (!replay) throw new Error('expected a replayed outbox claim')
    await firstWorker.complete(replay.id, replay.activeAttemptId, now)
    expect(await firstWorker.get('job-1')).toMatchObject({
      status: 'completed',
      attemptCount: 3,
      lastError: undefined,
    })
  })
})

import {
  SpecterIdempotencyConflictError,
  SpecterVersionConflictError,
} from '@specter-ts/core'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import type {
  PostgresPool,
  PostgresPoolClient,
  PostgresQueryResult,
} from './database'
import { createPostgresEventLog, preparePostgresEventLog } from './event-log'
import {
  createPostgresReactionOutboxStore,
  preparePostgresReactionOutbox,
} from './reaction-outbox'
import { createPostgresSliceStoreService } from './slice-store'

type EventRow = {
  id: string
  event_order: string
  type: string
  payload: unknown
  recorded_at: string
}

type OutboxRow = {
  id: string
  idempotency_key: string
  payload: unknown
  status: 'pending' | 'running' | 'completed' | 'dead-letter'
  requested_at: Date
  available_at: Date
  attempt_count: number
  active_attempt_id: string | null
  lease_expires_at: Date | null
  completed_at: Date | null
  last_error: string | null
}

class FakePostgresPool implements PostgresPool {
  readonly statements: string[] = []
  readonly events: EventRow[] = []
  readonly commits = new Map<
    string,
    {
      fingerprint: string | null
      first_event_order: string
      last_event_order: string
    }
  >()
  readonly sliceStates = new Map<
    string,
    { state_json: unknown; last_applied_order: string }
  >()
  readonly outbox = new Map<string, OutboxRow>()
  #lockTail = Promise.resolve()

  async query<TRow extends object = Record<string, unknown>>(
    sql: string,
    parameters: unknown[] = [],
  ): Promise<PostgresQueryResult<TRow>> {
    return this.#query(sql, parameters) as Promise<PostgresQueryResult<TRow>>
  }

  async connect(): Promise<PostgresPoolClient> {
    let releaseLock: (() => void) | undefined
    return {
      query: async <TRow extends object = Record<string, unknown>>(
        sql: string,
        parameters: unknown[] = [],
      ) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          const previous = this.#lockTail
          let release = () => {}
          const current = new Promise<void>((resolve) => {
            release = resolve
          })
          this.#lockTail = previous.then(() => current)
          await previous
          releaseLock = release
          this.statements.push(sql)
          return { rows: [] } as PostgresQueryResult<TRow>
        }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          releaseLock?.()
          releaseLock = undefined
          this.statements.push(sql)
          return { rows: [] } as PostgresQueryResult<TRow>
        }
        return this.#query(sql, parameters) as Promise<
          PostgresQueryResult<TRow>
        >
      },
      release() {},
    }
  }

  async #query(
    sql: string,
    parameters: readonly unknown[],
  ): Promise<PostgresQueryResult> {
    this.statements.push(sql)
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized.startsWith('SELECT COALESCE(MAX(event_order)')) {
      return { rows: [{ version: String(this.events.length) }] }
    }
    if (
      normalized.startsWith(
        'SELECT fingerprint, first_event_order, last_event_order',
      )
    ) {
      const commit = this.commits.get(String(parameters[0]))
      return { rows: commit ? [commit] : [] }
    }
    if (
      normalized.includes('FROM specter_events') &&
      normalized.includes('BETWEEN')
    ) {
      const first = Number(parameters[0])
      const last = Number(parameters[1])
      return {
        rows: this.events.filter(
          (event) =>
            Number(event.event_order) >= first &&
            Number(event.event_order) <= last,
        ),
      }
    }
    if (
      normalized.includes('FROM specter_events') &&
      normalized.includes('event_order >')
    ) {
      const afterOrder = Number(parameters[0])
      const eventTypes = new Set(parameters[1] as readonly string[])
      return {
        rows: this.events.filter(
          (event) =>
            Number(event.event_order) > afterOrder &&
            eventTypes.has(event.type),
        ),
      }
    }
    if (normalized.startsWith('INSERT INTO specter_events')) {
      const event: EventRow = {
        id: String(parameters[0]),
        event_order: String(this.events.length + 1),
        type: String(parameters[1]),
        payload: JSON.parse(String(parameters[2])) as unknown,
        recorded_at: String(parameters[3]),
      }
      this.events.push(event)
      return { rows: [{ event_order: event.event_order }], rowCount: 1 }
    }
    if (normalized.startsWith('INSERT INTO specter_event_commits')) {
      this.commits.set(String(parameters[0]), {
        fingerprint: parameters[1] === null ? null : String(parameters[1]),
        first_event_order: String(parameters[2]),
        last_event_order: String(parameters[3]),
      })
      return { rows: [], rowCount: 1 }
    }
    if (
      normalized.startsWith('SELECT state_json, last_applied_order') &&
      normalized.includes('FROM specter_slice_states')
    ) {
      const state = this.sliceStates.get(String(parameters[0]))
      return { rows: state ? [state] : [] }
    }
    if (normalized.startsWith('INSERT INTO specter_slice_states')) {
      this.sliceStates.set(String(parameters[0]), {
        state_json: JSON.parse(String(parameters[1])) as unknown,
        last_applied_order: String(parameters[2]),
      })
      return { rows: [], rowCount: 1 }
    }
    if (normalized.startsWith('INSERT INTO specter_reaction_outbox')) {
      const existing = [...this.outbox.values()].find(
        (row) => row.idempotency_key === String(parameters[1]),
      )
      if (existing) return { rows: [], rowCount: 0 }
      const row: OutboxRow = {
        id: String(parameters[0]),
        idempotency_key: String(parameters[1]),
        payload: JSON.parse(String(parameters[2])) as unknown,
        status: 'pending',
        requested_at: parameters[3] as Date,
        available_at: parameters[4] as Date,
        attempt_count: 0,
        active_attempt_id: null,
        lease_expires_at: null,
        completed_at: null,
        last_error: null,
      }
      this.outbox.set(row.id, row)
      return { rows: [row], rowCount: 1 }
    }
    if (
      normalized.startsWith('SELECT * FROM specter_reaction_outbox') &&
      normalized.includes('WHERE id = $1')
    ) {
      const row = this.outbox.get(String(parameters[0]))
      return { rows: row ? [row] : [] }
    }
    if (
      normalized.includes('FROM specter_reaction_outbox') &&
      normalized.includes('WHERE idempotency_key = $1')
    ) {
      const row = [...this.outbox.values()].find(
        (candidate) => candidate.idempotency_key === String(parameters[0]),
      )
      return { rows: row ? [row] : [] }
    }
    if (
      normalized.includes('FROM specter_reaction_outbox') &&
      normalized.includes('FOR UPDATE SKIP LOCKED')
    ) {
      return { rows: [] }
    }
    return { rows: [], rowCount: 0 }
  }
}

describe('Postgres Event Log adapter', () => {
  it('provides executable schema preparation without a live server', async () => {
    const pool = new FakePostgresPool()

    await preparePostgresEventLog(pool)
    await preparePostgresReactionOutbox(pool)

    expect(pool.statements.some((sql) => sql.includes('specter_events'))).toBe(
      true,
    )
    expect(
      pool.statements.some((sql) => sql.includes('specter_reaction_outbox')),
    ).toBe(true)
  })

  it('persists and retrieves durable idempotency receipts', async () => {
    const pool = new FakePostgresPool()
    let nextId = 0
    const eventLog = createPostgresEventLog(pool, {
      eventId: () => {
        nextId += 1
        return `event-${nextId}`
      },
      now: () => new Date(0),
    })
    const first = await eventLog.append(
      [{ type: 'todo-added', payload: { todoId: 'todo-1' } }],
      {
        expectedVersion: 0,
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-1',
      },
    )
    const duplicate = await eventLog.append(
      [{ type: 'ignored', payload: {} }],
      {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-1',
      },
    )

    expect(first.duplicate).toBe(false)
    expect(duplicate).toEqual({ ...first, duplicate: true })
    expect(pool.events).toHaveLength(1)
    const { duplicate: _duplicate, ...commit } = first
    expect(await eventLog.findCommit('request-1')).toEqual(commit)
    await expect(
      eventLog.append([{ type: 'changed', payload: {} }], {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-2',
      }),
    ).rejects.toBeInstanceOf(SpecterIdempotencyConflictError)
  })

  it('preserves top-level JSON-compatible primitives returned by a structural driver', async () => {
    const pool = new FakePostgresPool()
    const values = ['null', '123', 'true', null, 123, true] as const
    const eventLog = createPostgresEventLog(pool, {
      eventId: () => `event-${pool.events.length + 1}`,
      now: () => new Date(0),
    })

    await eventLog.append(
      values.map((value) => ({ type: 'value-recorded', payload: value })),
    )
    expect(
      (await eventLog.query(0, ['value-recorded'])).map(
        (event) => event.payload,
      ),
    ).toEqual(values)

    for (const [index, value] of values.entries()) {
      const store = createPostgresSliceStoreService(pool, () => value)
      const sliceName = `primitive${index}`
      await Effect.runPromise(
        store.transaction(sliceName, async (_write, _read, _cursor, publish) => {
          await publish(index + 1)
        }),
      )
      await Effect.runPromise(
        store.read(sliceName, async (read, cursor) => {
          expect(read).toBe(value)
          expect(cursor).toBe(index + 1)
        }),
      )
    }

    const outbox = createPostgresReactionOutboxStore<unknown>(pool)
    for (const [index, value] of values.entries()) {
      const id = `job-${index}`
      await outbox.enqueue({
        id,
        idempotencyKey: `delivery-${index}`,
        payload: value,
        requestedAt: new Date(0),
        availableAt: new Date(0),
      })
      expect((await outbox.get(id))?.payload).toBe(value)
    }
  })

  it('uses short transactions and an advisory lock for concurrent appends', async () => {
    const pool = new FakePostgresPool()
    const eventLog = createPostgresEventLog(pool, {
      eventId: () => `event-${pool.events.length + 1}`,
      now: () => new Date(0),
    })
    const append = (id: string) =>
      eventLog.append([{ type: 'created', payload: { id } }], {
        expectedVersion: 0,
      })

    const results = await Promise.allSettled([append('one'), append('two')])

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({
      reason: expect.any(SpecterVersionConflictError),
    })
    expect(pool.statements).toContain('BEGIN')
    expect(
      pool.statements.filter((sql) => sql.includes('pg_advisory_xact_lock')),
    ).toHaveLength(2)
  })

  it('does not hold a Postgres transaction during command decision work', async () => {
    const pool = new FakePostgresPool()
    const eventLog = createPostgresEventLog(pool, {
      eventId: () => 'event-1',
      now: () => new Date(0),
    })

    await eventLog.transaction(async (transaction) => {
      expect(pool.statements).not.toContain('BEGIN')
      await pool.query('INSERT INTO project_state (id) VALUES ($1)', [
        'state-1',
      ])
      await transaction.append([
        { type: 'project-state-published', payload: { id: 'state-1' } },
      ])
    })

    const stateWrite = pool.statements.findIndex((sql) =>
      sql.includes('INSERT INTO project_state'),
    )
    const begin = pool.statements.indexOf('BEGIN')
    expect(stateWrite).toBeGreaterThan(-1)
    expect(begin).toBeGreaterThan(stateWrite)
  })

  it('keeps published Slice State when a concurrent Event causes append conflict', async () => {
    const pool = new FakePostgresPool()
    const eventLog = createPostgresEventLog(pool, {
      eventId: () => `command-event-${pool.events.length + 1}`,
      now: () => new Date(0),
    })
    const competingEventLog = createPostgresEventLog(pool, {
      eventId: () => `competing-event-${pool.events.length + 1}`,
      now: () => new Date(0),
    })
    const store = createPostgresSliceStoreService(pool, () => ({ count: 0 }))

    await expect(
      eventLog.transaction(async (transaction) => {
        await Effect.runPromise(
          store.transaction('counter', async (write, _read, _cursor, publish) => {
            write.count = 9
            await publish(1)
          }),
        )

        await competingEventLog.append([
          { type: 'competing-event', payload: {} },
        ])
        await transaction.append([
          { type: 'counter-incremented', payload: { amount: 9 } },
        ])
      }),
    ).rejects.toBeInstanceOf(SpecterVersionConflictError)

    expect(await eventLog.currentVersion()).toBe(1)
    await Effect.runPromise(
      store.read('counter', async (read, cursor) => {
        expect(read).toEqual({ count: 9 })
        expect(cursor).toBe(1)
      }),
    )
  })

  it('queues top-level appends behind an active command callback', async () => {
    const pool = new FakePostgresPool()
    const eventLog = createPostgresEventLog(pool, {
      eventId: () => `event-${pool.events.length + 1}`,
      now: () => new Date(0),
    })
    let enterCommand = () => {}
    const commandEntered = new Promise<void>((resolve) => {
      enterCommand = resolve
    })
    let releaseCommand = () => {}
    const commandGate = new Promise<void>((resolve) => {
      releaseCommand = resolve
    })

    const command = eventLog.transaction(async (transaction) => {
      enterCommand()
      await commandGate
      return transaction.append([{ type: 'command-event', payload: {} }])
    })
    await commandEntered
    const directAppend = eventLog.append([
      { type: 'direct-event', payload: {} },
    ])
    releaseCommand()

    const [commandCommit, directCommit] = await Promise.all([
      command,
      directAppend,
    ])
    expect(commandCommit.events[0]).toMatchObject({
      order: 1,
      type: 'command-event',
    })
    expect(directCommit.events[0]).toMatchObject({
      order: 2,
      type: 'direct-event',
    })
  })

  it('claims outbox work with Postgres row-lock skipping semantics', async () => {
    const pool = new FakePostgresPool()
    const store = createPostgresReactionOutboxStore(pool)

    expect(await store.claimNext(new Date(0), new Date(10))).toBeUndefined()
    expect(
      pool.statements.some((sql) => sql.includes('FOR UPDATE SKIP LOCKED')),
    ).toBe(true)
  })

  it('publishes staged Slice State only when the cursor advances', async () => {
    const pool = new FakePostgresPool()
    const store = createPostgresSliceStoreService(pool, () => ({ count: 0 }))
    await Effect.runPromise(
      store.transaction('counter', async (write) => {
        write.count = 9
      }),
    )
    await Effect.runPromise(
      store.read('counter', async (read) => {
        expect(read).toEqual({ count: 0 })
      }),
    )

    await Effect.runPromise(
      store.transaction('counter', async (write, _read, _cursor, publish) => {
        write.count = 3
        await publish(2)
      }),
    )
    await Effect.runPromise(
      store.read('counter', async (read, cursor) => {
        expect(read).toEqual({ count: 3 })
        expect(cursor).toBe(2)
      }),
    )
  })
})

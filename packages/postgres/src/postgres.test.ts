import { createHash } from 'node:crypto'

import { EventLogFailure, SpecterVersionConflictError } from '@specter-ts/core'
import { testEventLogService } from '@specter-ts/core/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import type {
  PostgresPool,
  PostgresPoolClient,
  PostgresQueryResult,
} from './database'
import { createPostgresEventLogService } from './event-log'
import { migrateSpecterPostgres } from './migrations'
import { specterPostgresMigrations } from './persistence'
import { createPostgresReactionOutboxStore } from './reaction-outbox'
import { createPostgresSliceStoreService } from './slice-store'

type EventRow = {
  id: string
  event_order: string
  type: string
  payload: unknown
  recorded_at: string
}

type KeyRow = {
  event_order: string
  name: string
  value: string
}

type CommitRow = {
  commit_version: string
  idempotency_key: string | null
  fingerprint: string | null
  first_event_order: string
  last_event_order: string
  committed_at: Date
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

testEventLogService('Postgres (fake pool)', () =>
  createPostgresEventLogService(new FakePostgresPool()),
)

/** A read's LIMIT parameter: null, or absent, reads every row. */
function limitOf(parameter: unknown) {
  return parameter === null || parameter === undefined
    ? Number.POSITIVE_INFINITY
    : Number(parameter)
}

class FakePostgresPool implements PostgresPool {
  readonly statements: string[] = []
  readonly events: EventRow[] = []
  readonly keys: KeyRow[] = []
  readonly commits: CommitRow[] = []
  readonly sliceStates = new Map<
    string,
    {
      version: string
      state_json: unknown
      last_applied_order: string
      reached: string
    }
  >()
  readonly purges = new Map<string, number>()
  #nextOrder = 1
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

  // An Event row as the adapter selects it: with its stored keys as one
  // JSON object.
  #withKeys(event: EventRow) {
    return {
      ...event,
      event_keys: Object.fromEntries(
        this.keys
          .filter((key) => key.event_order === event.event_order)
          .map((key) => [key.name, key.value]),
      ),
    }
  }

  #event(order: unknown) {
    return this.events.find((event) => event.event_order === String(order))
  }

  async #query(
    sql: string,
    parameters: readonly unknown[],
  ): Promise<PostgresQueryResult> {
    this.statements.push(sql)
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized.startsWith('SELECT GREATEST(')) {
      return {
        rows: [
          {
            version: String(
              Math.max(
                0,
                ...this.events.map((event) => Number(event.event_order)),
                ...this.purges.values(),
              ),
            ),
          },
        ],
      }
    }
    if (normalized.includes('NOT (e.type = ANY($3::text[]))')) {
      const keep = new Set(parameters[2] as readonly string[])
      return {
        rows: this.keys
          .filter(
            (key) =>
              key.name === parameters[0] &&
              key.value === parameters[1] &&
              !keep.has(this.#event(key.event_order)?.type ?? ''),
          )
          .map((key) => ({
            event_order: key.event_order,
            type: this.#event(key.event_order)?.type,
          }))
          .sort(
            (left, right) =>
              Number(left.event_order) - Number(right.event_order),
          ),
      }
    }
    if (normalized.startsWith('INSERT INTO specter_event_purges')) {
      const types = parameters[0] as readonly string[]
      const orders = parameters[1] as readonly number[]
      for (const [index, type] of types.entries()) {
        this.purges.set(
          type,
          Math.max(this.purges.get(type) ?? 0, Number(orders[index])),
        )
      }
      return { rows: [], rowCount: types.length }
    }
    if (
      normalized.startsWith('SELECT through_order FROM specter_event_purges')
    ) {
      const types = parameters[1] as readonly string[]
      const found = types
        .map((type) => this.purges.get(type) ?? 0)
        .filter((order) => order > Number(parameters[0]))
        .sort((left, right) => left - right)
      return { rows: found.length > 0 ? [{ through_order: found[0] }] : [] }
    }
    if (normalized.startsWith('DELETE FROM specter_event_keys')) {
      const orders = new Set((parameters[0] as number[]).map(String))
      const left = this.keys.filter((key) => !orders.has(key.event_order))
      this.keys.splice(0, this.keys.length, ...left)
      return { rows: [] }
    }
    if (normalized.startsWith('DELETE FROM specter_events')) {
      const orders = new Set((parameters[0] as number[]).map(String))
      if (this.keys.some((key) => orders.has(key.event_order))) {
        throw new Error('violates foreign key constraint')
      }
      const left = this.events.filter((event) => !orders.has(event.event_order))
      this.events.splice(0, this.events.length, ...left)
      return { rows: [] }
    }
    if (normalized.startsWith('DELETE FROM specter_event_commits')) {
      const left = this.commits.filter(
        (commit) =>
          Number(commit.last_event_order) < Number(parameters[0]) ||
          Number(commit.first_event_order) > Number(parameters[1]) ||
          this.events.some(
            (event) =>
              Number(event.event_order) >= Number(commit.first_event_order) &&
              Number(event.event_order) <= Number(commit.last_event_order),
          ),
      )
      this.commits.splice(0, this.commits.length, ...left)
      return { rows: [] }
    }
    if (
      normalized.startsWith(
        'SELECT idempotency_key, fingerprint, first_event_order',
      ) &&
      normalized.includes('WHERE idempotency_key = $1')
    ) {
      const commit = this.commits.find(
        (row) => row.idempotency_key === String(parameters[0]),
      )
      return { rows: commit ? [commit] : [] }
    }
    if (
      normalized.startsWith(
        'SELECT idempotency_key, fingerprint, first_event_order',
      ) &&
      normalized.includes('WHERE commit_version > $1')
    ) {
      return {
        rows: this.commits
          .filter((row) => Number(row.commit_version) > Number(parameters[0]))
          .slice(0, limitOf(parameters[1])),
      }
    }
    if (
      normalized.includes('FROM specter_events') &&
      normalized.includes('BETWEEN')
    ) {
      const first = Number(parameters[0])
      const last = Number(parameters[1])
      return {
        rows: this.events
          .filter(
            (event) =>
              Number(event.event_order) >= first &&
              Number(event.event_order) <= last,
          )
          .map((event) => this.#withKeys(event)),
      }
    }
    if (
      normalized.includes('FROM specter_events') &&
      normalized.includes('event_order >')
    ) {
      const afterOrder = Number(parameters[0])
      const eventTypes = new Set(parameters[1] as readonly string[])
      return {
        rows: this.events
          .filter(
            (event) =>
              Number(event.event_order) > afterOrder &&
              eventTypes.has(event.type),
          )
          .slice(0, limitOf(parameters[2]))
          .map((event) => this.#withKeys(event)),
      }
    }
    if (normalized.startsWith('INSERT INTO specter_event_keys')) {
      const names = parameters[1] as readonly string[]
      const values = parameters[2] as readonly string[]
      for (const [index, name] of names.entries()) {
        this.keys.push({
          event_order: String(parameters[0]),
          name,
          value: values[index] as string,
        })
      }
      return { rows: [], rowCount: names.length }
    }
    if (
      normalized.includes('FROM specter_event_keys k') &&
      normalized.includes('unnest($3::text[], $4::text[])')
    ) {
      const afterOrder = Number(parameters[0])
      const eventTypes = new Set(parameters[1] as readonly string[])
      const names = parameters[2] as readonly string[]
      const values = parameters[3] as readonly string[]
      const stale = this.keys.find(
        (key) =>
          Number(key.event_order) > afterOrder &&
          eventTypes.has(this.#event(key.event_order)?.type ?? '') &&
          names.some(
            (name, index) => name === key.name && values[index] === key.value,
          ),
      )
      return { rows: stale ? [{ event_order: stale.event_order }] : [] }
    }
    if (
      normalized.includes('FROM specter_event_keys k') &&
      normalized.includes('WHERE k.name = $1 AND k.value = $2')
    ) {
      const afterOrder = Number(parameters[2])
      const limit =
        parameters[3] === null
          ? Number.POSITIVE_INFINITY
          : Number(parameters[3])
      return {
        rows: this.keys
          .filter(
            (key) =>
              key.name === parameters[0] &&
              key.value === parameters[1] &&
              Number(key.event_order) > afterOrder,
          )
          .slice(0, limit)
          .map((key) =>
            this.#withKeys(this.#event(key.event_order) as EventRow),
          ),
      }
    }
    if (normalized.startsWith('INSERT INTO specter_events')) {
      if (this.events.some((event) => event.id === String(parameters[0]))) {
        throw new Error('duplicate key value violates unique constraint')
      }
      const event: EventRow = {
        id: String(parameters[0]),
        event_order: String(this.#nextOrder++),
        type: String(parameters[1]),
        payload: JSON.parse(String(parameters[2])) as unknown,
        recorded_at: String(parameters[3]),
      }
      this.events.push(event)
      return { rows: [{ event_order: event.event_order }], rowCount: 1 }
    }
    if (normalized.startsWith('INSERT INTO specter_event_commits')) {
      this.commits.push({
        commit_version: String(parameters[0]),
        idempotency_key: parameters[1] === null ? null : String(parameters[1]),
        fingerprint: parameters[2] === null ? null : String(parameters[2]),
        first_event_order: String(parameters[3]),
        last_event_order: String(parameters[4]),
        committed_at: parameters[5] as Date,
      })
      return { rows: [], rowCount: 1 }
    }
    if (
      normalized.startsWith('SELECT version, state_json, last_applied_order') &&
      normalized.includes('FROM specter_slice_states')
    ) {
      const state = this.sliceStates.get(String(parameters[0]))
      return { rows: state ? [state] : [] }
    }
    if (normalized.startsWith('INSERT INTO specter_slice_states')) {
      const current = this.sliceStates.get(String(parameters[0]))
      if (
        current &&
        current.version === String(parameters[1]) &&
        Number(current.last_applied_order) > Number(parameters[3])
      ) {
        return { rows: [], rowCount: 0 }
      }
      this.sliceStates.set(String(parameters[0]), {
        version: String(parameters[1]),
        state_json: JSON.parse(String(parameters[2])) as unknown,
        last_applied_order: String(parameters[3]),
        reached: String(
          Math.max(
            Number(current?.reached ?? 0),
            Number(current?.last_applied_order ?? 0),
            Number(parameters[4]),
          ),
        ),
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
  it('applies its migrations and records them without a live server', async () => {
    const pool = new FakePostgresPool()

    const applied = await migrateSpecterPostgres(
      pool,
      specterPostgresMigrations,
    )

    expect(applied).toEqual(specterPostgresMigrations)
    for (const table of [
      'specter_events',
      'specter_slice_states',
      'specter_reaction_outbox',
    ])
      expect(
        pool.statements.some((sql) => sql.includes(`CREATE TABLE ${table}`)),
      ).toBe(true)
    expect(
      pool.statements.filter((sql) =>
        sql.includes('INSERT INTO specter_migrations'),
      ),
    ).toHaveLength(specterPostgresMigrations.length)
  })

  it('never changes a released migration', () => {
    // A release that changes a store's tables adds a version; these are the
    // digests of the released ones.
    expect(
      Object.fromEntries(
        specterPostgresMigrations.map((migration) => [
          `${migration.store}@${migration.version}`,
          createHash('sha256')
            .update(JSON.stringify(migration.statements))
            .digest('hex')
            .slice(0, 16),
        ]),
      ),
    ).toEqual({
      'event-log@1': '839bde45c2c9dcb6',
      'slice-store@1': '8eaf4de51918147a',
      'reaction-outbox@1': '1382c3d965cf6b90',
    })
  })

  it('persists and retrieves durable idempotency receipts', async () => {
    const pool = new FakePostgresPool()
    let nextId = 0
    const eventLog = createPostgresEventLogService(pool, {
      eventId: () => {
        nextId += 1
        return `event-${nextId}`
      },
      now: () => new Date(0),
    })
    const first = await Effect.runPromise(
      eventLog.append(
        [{ type: 'todo-added', payload: { todoId: 'todo-1' }, keys: {} }],
        {
          expectedVersion: 0,
          idempotencyKey: 'request-1',
          fingerprint: 'fingerprint-1',
        },
      ),
    )
    const duplicate = await Effect.runPromise(
      eventLog.append([{ type: 'ignored', payload: {}, keys: {} }], {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-1',
      }),
    )

    expect(first.duplicate).toBe(false)
    expect(duplicate).toEqual({ ...first, duplicate: true })
    expect(pool.events).toHaveLength(1)
    const { duplicate: _duplicate, ...commit } = first
    expect(await Effect.runPromise(eventLog.findCommit('request-1'))).toEqual(
      commit,
    )
    const changed = await Effect.runPromise(
      eventLog.append([{ type: 'changed', payload: {}, keys: {} }], {
        idempotencyKey: 'request-1',
        fingerprint: 'fingerprint-2',
      }),
    )
    expect(changed).toEqual({ ...first, duplicate: true })
    expect(changed.fingerprint).toBe('fingerprint-1')
    expect(pool.events).toHaveLength(1)
  })

  it('preserves top-level JSON-compatible primitives returned by a structural driver', async () => {
    const pool = new FakePostgresPool()
    const values = ['null', '123', 'true', null, 123, true] as const
    const eventLog = createPostgresEventLogService(pool, {
      eventId: () => `event-${pool.events.length + 1}`,
      now: () => new Date(0),
    })

    await Effect.runPromise(
      eventLog.append(
        values.map((value) => ({
          type: 'value-recorded',
          payload: value,
          keys: {},
        })),
      ),
    )
    expect(
      (await Effect.runPromise(eventLog.query(0, ['value-recorded']))).map(
        (event) => event.payload,
      ),
    ).toEqual(values)

    for (const [index, value] of values.entries()) {
      const store = createPostgresSliceStoreService(pool, () => value)
      const sliceName = `primitive${index}`
      await Effect.runPromise(
        store.transaction(
          { name: sliceName, version: 'v1' },
          (_write, _read, _cursor, publish) => publish(index + 1),
        ),
      )
      await Effect.runPromise(
        store.read({ name: sliceName, version: 'v1' }, (read, cursor) =>
          Effect.sync(() => {
            expect(read).toBe(value)
            expect(cursor).toBe(index + 1)
          }),
        ),
      )
    }

    const outbox = createPostgresReactionOutboxStore<unknown>(pool)
    for (const [index, value] of values.entries()) {
      const id = `job-${index}`
      await Effect.runPromise(
        outbox.enqueue({
          id,
          idempotencyKey: `delivery-${index}`,
          payload: value,
          requestedAt: new Date(0),
          availableAt: new Date(0),
        }),
      )
      expect((await Effect.runPromise(outbox.get(id)))?.payload).toBe(value)
    }

    const custom = createPostgresReactionOutboxStore<{ value: bigint }>(pool, {
      codec: {
        encode: (payload) => ({ value: payload.value.toString() }),
        decode: (payload) => ({
          value: BigInt((payload as { value: string }).value),
        }),
      },
    })
    await Effect.runPromise(
      custom.enqueue({
        id: 'custom-job',
        idempotencyKey: 'custom-delivery',
        payload: { value: 42n },
        requestedAt: new Date(0),
        availableAt: new Date(0),
      }),
    )
    expect(await Effect.runPromise(custom.get('custom-job'))).toMatchObject({
      payload: { value: 42n },
    })
  })

  it('uses short transactions and an advisory lock for concurrent appends', async () => {
    const pool = new FakePostgresPool()
    const eventLog = createPostgresEventLogService(pool, {
      eventId: () => `event-${pool.events.length + 1}`,
      now: () => new Date(0),
    })
    const append = (id: string) =>
      Effect.runPromise(
        eventLog.append([{ type: 'created', payload: { id }, keys: {} }], {
          expectedVersion: 0,
        }),
      )

    const results = await Promise.allSettled([append('one'), append('two')])

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected?.reason).toBeInstanceOf(EventLogFailure)
    expect(rejected?.reason.cause).toBeInstanceOf(SpecterVersionConflictError)
    expect(pool.statements).toContain('BEGIN')
    expect(
      pool.statements.filter((sql) => sql.includes('pg_advisory_xact_lock')),
    ).toHaveLength(2)
  })

  it('claims outbox work with Postgres row-lock skipping semantics', async () => {
    const pool = new FakePostgresPool()
    const store = createPostgresReactionOutboxStore(pool)

    expect(
      await Effect.runPromise(store.claimNext(new Date(0), new Date(10))),
    ).toBeUndefined()
    expect(
      pool.statements.some((sql) => sql.includes('FOR UPDATE SKIP LOCKED')),
    ).toBe(true)
  })

  it('publishes staged Slice State only when the cursor advances', async () => {
    const pool = new FakePostgresPool()
    const store = createPostgresSliceStoreService(pool, () => ({ count: 0 }))
    await Effect.runPromise(
      store.transaction({ name: 'counter', version: 'v1' }, (write) =>
        Effect.sync(() => {
          write.count = 9
        }),
      ),
    )
    await Effect.runPromise(
      store.read({ name: 'counter', version: 'v1' }, (read) =>
        Effect.sync(() => {
          expect(read).toEqual({ count: 0 })
        }),
      ),
    )

    await Effect.runPromise(
      store.transaction(
        { name: 'counter', version: 'v1' },
        (write, _read, _cursor, publish) =>
          Effect.gen(function* () {
            write.count = 3
            yield* publish(2)
          }),
      ),
    )
    await Effect.runPromise(
      store.read({ name: 'counter', version: 'v1' }, (read, cursor) =>
        Effect.sync(() => {
          expect(read).toEqual({ count: 3 })
          expect(cursor).toBe(2)
        }),
      ),
    )
  })

  it('serializes competing Slice catchups at the shared database resource', async () => {
    const pool = new FakePostgresPool()
    const store = createPostgresSliceStoreService(pool, () => ({ count: 0 }))
    let entered = () => {}
    const firstEntered = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = Effect.runPromise(
      store.transaction(
        { name: 'counter', version: 'v1' },
        (write, _read, _cursor, publish) =>
          Effect.gen(function* () {
            entered()
            yield* Effect.promise(() => gate)
            write.count = 12
            yield* publish(12)
          }),
      ),
    )
    await firstEntered
    const second = Effect.runPromise(
      store.transaction(
        { name: 'counter', version: 'v1' },
        (write, _read, cursor, publish) =>
          Effect.gen(function* () {
            expect(cursor).toBe(12)
            write.count = 13
            yield* publish(13)
          }),
      ),
    )
    release()
    await Promise.all([first, second])

    expect(
      await Effect.runPromise(
        store.read({ name: 'counter', version: 'v1' }, (read, cursor) =>
          Effect.succeed({ count: read.count, cursor }),
        ),
      ),
    ).toEqual({ count: 13, cursor: 13 })
  })
})

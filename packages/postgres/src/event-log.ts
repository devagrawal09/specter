import { randomUUID } from 'node:crypto'

import {
  EventLog,
  EventLogFailure,
  SpecterVersionConflictError,
  type EventKey,
  type EventLogAppendCondition,
  type EventLogAppendOptions,
  type EventLogAppendResult,
  type EventLogCommit,
  type EventLogDraft,
  type EventLogKeyPage,
  type EventLogService,
  type PersistedEvent,
} from '@specter-ts/core'
import { Effect, Layer } from 'effect'

import {
  createPostgresDatabaseContext,
  postgresDate,
  postgresJson,
  postgresNumber,
  postgresString,
  type PostgresConnection,
  type PostgresDatabaseContext,
  type PostgresDatabaseOptions,
  type PostgresPool,
} from './database'

export type PostgresEventLogOptions = PostgresDatabaseOptions & {
  readonly context?: PostgresDatabaseContext
  readonly eventId?: () => string
  readonly now?: () => Date
}

export type PostgresEventLogService = EventLogService & {
  readonly context: PostgresDatabaseContext
}

export async function preparePostgresEventLog(pool: PostgresPool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS specter_events (
    event_order BIGSERIAL PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    payload JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL
  )`)
  await pool.query(`CREATE INDEX IF NOT EXISTS specter_events_type_order_idx
    ON specter_events(type, event_order)`)
  await pool.query(`CREATE TABLE IF NOT EXISTS specter_event_commits (
    commit_version BIGINT PRIMARY KEY,
    idempotency_key TEXT UNIQUE,
    fingerprint TEXT,
    first_event_order BIGINT NOT NULL,
    last_event_order BIGINT NOT NULL,
    committed_at TIMESTAMPTZ NOT NULL
  )`)
  // Each Event's named keys, as core derived them when it was appended.
  await pool.query(`CREATE TABLE IF NOT EXISTS specter_event_keys (
    event_order BIGINT NOT NULL REFERENCES specter_events(event_order),
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (event_order, name)
  )`)
  await pool.query(`CREATE INDEX IF NOT EXISTS specter_event_keys_name_value_order_idx
    ON specter_event_keys(name, value, event_order)`)
}

export function createPostgresEventLogService(
  pool: PostgresPool,
  options: PostgresEventLogOptions = {},
): PostgresEventLogService {
  const context =
    options.context ?? createPostgresDatabaseContext(pool, options)
  const advisoryLockKey = options.advisoryLockKey ?? context.advisoryLockKey
  const eventId = options.eventId ?? randomUUID
  const now = options.now ?? (() => new Date())

  function toEvent(row: Record<string, unknown>): PersistedEvent {
    return {
      id: postgresString(row.id, 'event id'),
      order: postgresNumber(row.event_order, 'event order'),
      type: postgresString(row.type, 'event type'),
      payload: postgresJson(row.payload, 'event payload'),
      recordedAt: postgresDate(row.recorded_at, 'recorded time').toISOString(),
    }
  }

  async function query(
    connection: PostgresConnection,
    afterOrder: number,
    eventTypes: readonly string[],
  ) {
    if (!eventTypes.length) return []
    const result = await connection.query(
      `SELECT id, event_order, type, payload, recorded_at
       FROM specter_events
       WHERE event_order > $1 AND type = ANY($2::text[])
       ORDER BY event_order ASC`,
      [afterOrder, eventTypes],
    )
    return result.rows.map((row) => toEvent(row))
  }

  /**
   * The order of the first Event appended after the condition's read that it
   * covers, or undefined when there is none. Checked in SQL, from the stored
   * keys.
   */
  async function staleOrder(
    connection: PostgresConnection,
    condition: EventLogAppendCondition,
  ): Promise<number | undefined> {
    if (condition.eventTypes.length === 0) return undefined
    if (!condition.keys) {
      const result = await connection.query<{ event_order: unknown }>(
        `SELECT event_order FROM specter_events
         WHERE event_order > $1 AND type = ANY($2::text[])
         ORDER BY event_order ASC LIMIT 1`,
        [condition.afterOrder, condition.eventTypes],
      )
      const row = result.rows[0]
      return row
        ? postgresNumber(row.event_order, 'stale event order')
        : undefined
    }
    const pairs = Object.entries(condition.keys).flatMap(([name, values]) =>
      values.map((value) => [name, value] as const),
    )
    if (pairs.length === 0) return undefined
    const result = await connection.query<{ event_order: unknown }>(
      `SELECT k.event_order FROM specter_event_keys k
       JOIN specter_events e ON e.event_order = k.event_order
       WHERE k.event_order > $1 AND e.type = ANY($2::text[])
         AND (k.name, k.value) IN (
           SELECT * FROM unnest($3::text[], $4::text[])
         )
       ORDER BY k.event_order ASC LIMIT 1`,
      [
        condition.afterOrder,
        condition.eventTypes,
        pairs.map(([name]) => name),
        pairs.map(([, value]) => value),
      ],
    )
    const row = result.rows[0]
    return row
      ? postgresNumber(row.event_order, 'stale event order')
      : undefined
  }

  async function readKey(
    connection: PostgresConnection,
    key: EventKey,
    page: EventLogKeyPage,
  ) {
    const result = await connection.query(
      `SELECT e.id, e.event_order, e.type, e.payload, e.recorded_at
       FROM specter_event_keys k
       JOIN specter_events e ON e.event_order = k.event_order
       WHERE k.name = $1 AND k.value = $2 AND k.event_order > $3
       ORDER BY k.event_order ASC
       LIMIT $4`,
      [key.name, key.value, page.afterOrder ?? 0, page.limit ?? null],
    )
    return result.rows.map((row) => toEvent(row))
  }

  async function currentVersion(connection: PostgresConnection) {
    const result = await connection.query<{ version: unknown }>(
      'SELECT COALESCE(MAX(event_order), 0) AS version FROM specter_events',
    )
    return postgresNumber(result.rows[0]?.version, 'Event Log version')
  }

  async function findCommit(
    connection: PostgresConnection,
    idempotencyKey: string,
  ): Promise<EventLogCommit | undefined> {
    const receipt = await connection.query(
      `SELECT idempotency_key, fingerprint, first_event_order,
         last_event_order, committed_at
       FROM specter_event_commits
       WHERE idempotency_key = $1`,
      [idempotencyKey],
    )
    const row = receipt.rows[0]
    if (!row) return undefined
    return commitFromRow(connection, row)
  }

  async function commitFromRow(
    connection: PostgresConnection,
    row: Record<string, unknown>,
  ): Promise<EventLogCommit> {
    const firstOrder = postgresNumber(
      row.first_event_order,
      'first commit event order',
    )
    const version = postgresNumber(row.last_event_order, 'commit version')
    const eventRows = await connection.query(
      `SELECT id, event_order, type, payload, recorded_at
       FROM specter_events
       WHERE event_order BETWEEN $1 AND $2
       ORDER BY event_order ASC`,
      [firstOrder, version],
    )
    return {
      events: eventRows.rows.map(toEvent),
      version,
      committedAt: postgresDate(row.committed_at, 'commit time').toISOString(),
      idempotencyKey:
        row.idempotency_key === null
          ? undefined
          : postgresString(row.idempotency_key, 'commit idempotency key'),
      fingerprint:
        row.fingerprint === null
          ? undefined
          : postgresString(row.fingerprint, 'commit fingerprint'),
    }
  }

  async function commitsAfter(
    connection: PostgresConnection,
    afterVersion: number,
  ): Promise<readonly EventLogCommit[]> {
    const result = await connection.query(
      `SELECT idempotency_key, fingerprint, first_event_order,
         last_event_order, committed_at
       FROM specter_event_commits
       WHERE commit_version > $1
       ORDER BY commit_version ASC`,
      [afterVersion],
    )
    return Promise.all(result.rows.map((row) => commitFromRow(connection, row)))
  }

  async function append(
    connection: PostgresConnection,
    drafts: readonly EventLogDraft[],
    appendOptions: EventLogAppendOptions = {},
  ): Promise<EventLogAppendResult> {
    const existing = appendOptions.idempotencyKey
      ? await findCommit(connection, appendOptions.idempotencyKey)
      : undefined
    if (existing) {
      return { ...existing, duplicate: true }
    }
    if (drafts.length === 0) {
      throw new Error('Event Log append requires at least one Event')
    }

    const version = await currentVersion(connection)
    if (
      appendOptions.expectedVersion !== undefined &&
      appendOptions.expectedVersion !== version
    ) {
      throw new SpecterVersionConflictError(
        appendOptions.expectedVersion,
        version,
      )
    }
    const unchanged = appendOptions.expectedUnchanged
    const stale = unchanged && (await staleOrder(connection, unchanged))
    if (unchanged && stale !== undefined) {
      throw new SpecterVersionConflictError(unchanged.afterOrder, stale)
    }

    const events: PersistedEvent[] = []
    for (const draft of drafts) {
      const id = eventId()
      const recordedAt = now().toISOString()
      const encodedPayload = JSON.stringify(draft.payload)
      if (encodedPayload === undefined) {
        throw new Error('Postgres Event payload must be JSON-serializable')
      }
      const result = await connection.query<{ event_order: unknown }>(
        `INSERT INTO specter_events (id, type, payload, recorded_at)
         VALUES ($1, $2, $3::jsonb, $4)
         RETURNING event_order`,
        [id, draft.type, encodedPayload, recordedAt],
      )
      const order = postgresNumber(
        result.rows[0]?.event_order,
        'inserted event order',
      )
      const keys = Object.entries(draft.keys)
      if (keys.length > 0) {
        await connection.query(
          `INSERT INTO specter_event_keys (event_order, name, value)
           SELECT $1, name, value FROM unnest($2::text[], $3::text[])
             AS keys(name, value)`,
          [order, keys.map(([name]) => name), keys.map(([, value]) => value)],
        )
      }
      events.push({
        type: draft.type,
        payload: draft.payload,
        id,
        order,
        recordedAt,
      })
    }
    const committedVersion = events.at(-1)?.order ?? version
    const committedAt = now()
    await connection.query(
      `INSERT INTO specter_event_commits (
        commit_version,
        idempotency_key,
        fingerprint,
        first_event_order,
        last_event_order,
        committed_at
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        committedVersion,
        appendOptions.idempotencyKey ?? null,
        appendOptions.fingerprint ?? null,
        events[0]?.order ?? version,
        committedVersion,
        committedAt,
      ],
    )
    return {
      events,
      version: committedVersion,
      committedAt: committedAt.toISOString(),
      idempotencyKey: appendOptions.idempotencyKey,
      fingerprint: appendOptions.fingerprint,
      duplicate: false,
    }
  }

  function attempt<A>(
    operation: EventLogFailure['operation'],
    run: () => Promise<A>,
  ) {
    return Effect.tryPromise({
      try: run,
      catch: (cause) => new EventLogFailure(operation, cause),
    })
  }

  return {
    capabilities: { scopedAppend: true, keyedRead: true },
    context,
    query: (afterOrder, eventTypes) =>
      context.use((connection) =>
        attempt('query', () => query(connection, afterOrder, eventTypes)),
      ),
    currentVersion: context.use((connection) =>
      attempt('currentVersion', () => currentVersion(connection)),
    ),
    readKey: (key, page = {}) =>
      context.use((connection) =>
        attempt('readKey', () => readKey(connection, key, page)),
      ),
    commitsAfter: (afterVersion) =>
      context.use((connection) =>
        attempt('commitsAfter', () => commitsAfter(connection, afterVersion)),
      ),
    findCommit: (idempotencyKey) =>
      context.use((connection) =>
        attempt('findCommit', () => findCommit(connection, idempotencyKey)),
      ),
    append: (drafts, appendOptions) =>
      context
        .transaction((connection) =>
          Effect.gen(function* () {
            yield* attempt('append', () =>
              connection.query('SELECT pg_advisory_xact_lock($1)', [
                advisoryLockKey,
              ]),
            )
            return yield* attempt('append', () =>
              append(connection, drafts, appendOptions),
            )
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            cause instanceof EventLogFailure
              ? cause
              : new EventLogFailure('append', cause),
          ),
        ),
  }
}

export function createPostgresEventLogLayer(
  pool: PostgresPool,
  options: PostgresEventLogOptions = {},
): Layer.Layer<EventLog> {
  return Layer.succeed(EventLog, createPostgresEventLogService(pool, options))
}

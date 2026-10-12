import { randomUUID } from 'node:crypto'

import type { Client } from '@libsql/client'
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
  type EventLogPage,
  type EventLogService,
  type PersistedEvent,
} from '@specter-ts/core'
import { Effect, Layer } from 'effect'

import {
  createSqliteDatabaseContext,
  requireNumber,
  requireString,
  type SqliteConnection,
  type SqliteDatabaseContext,
} from './database'

export type SqliteEventCodec = {
  encode(payload: unknown): string
  decode(payload: string): unknown
}

export type SqliteEventLogOptions = {
  readonly context?: SqliteDatabaseContext
  readonly eventId?: () => string
  readonly now?: () => Date
  readonly codec?: SqliteEventCodec
}

export type SqliteEventLogService = EventLogService & {
  readonly context: SqliteDatabaseContext
}

type CommitTableShape = 'versioned' | 'legacy'

const jsonCodec: SqliteEventCodec = {
  encode(payload) {
    const encoded = JSON.stringify(payload)
    if (encoded === undefined) {
      throw new Error('SQLite Event payload must be JSON-serializable')
    }
    return encoded
  },
  decode: JSON.parse,
}

export async function prepareSqliteEventLog(client: Client) {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS specter_events (
        event_order INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS specter_events_type_order_idx
        ON specter_events(type, event_order)`,
      `CREATE TABLE IF NOT EXISTS specter_event_commits (
        commit_version INTEGER PRIMARY KEY,
        idempotency_key TEXT UNIQUE,
        fingerprint TEXT,
        first_event_order INTEGER NOT NULL,
        last_event_order INTEGER NOT NULL,
        committed_at TEXT NOT NULL
      )`,
      // Each Event's named keys, as core derived them when it was appended.
      `CREATE TABLE IF NOT EXISTS specter_event_keys (
        event_order INTEGER NOT NULL REFERENCES specter_events(event_order),
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (event_order, name)
      )`,
      `CREATE INDEX IF NOT EXISTS specter_event_keys_name_value_order_idx
        ON specter_event_keys(name, value, event_order)`,
    ],
    'write',
  )
}

/**
 * An Event's columns, with the keys stored with it as one JSON object, for a
 * query whose `specter_events` alias is `e`.
 */
const eventColumns = `e.id, e.event_order, e.type, e.payload, e.recorded_at,
  (SELECT json_group_object(stored.name, stored.value)
    FROM specter_event_keys stored
    WHERE stored.event_order = e.event_order) AS event_keys`

/** The keys stored with an Event, from their JSON object column. */
function storedKeys(value: unknown): Readonly<Record<string, string>> {
  const keys: unknown = JSON.parse(requireString(value, 'event keys'))
  if (
    typeof keys !== 'object' ||
    keys === null ||
    Array.isArray(keys) ||
    !Object.values(keys).every((key) => typeof key === 'string')
  ) {
    throw new Error('Expected SQLite event keys to be an object of strings')
  }
  return keys as Readonly<Record<string, string>>
}

export function createSqliteEventLogService(
  client: Client,
  options: SqliteEventLogOptions = {},
): SqliteEventLogService {
  const context = options.context ?? createSqliteDatabaseContext(client)
  const eventId = options.eventId ?? randomUUID
  const now = options.now ?? (() => new Date())
  const codec = options.codec ?? jsonCodec
  let commitTableShape: Promise<CommitTableShape> | undefined

  function getCommitTableShape(connection: SqliteConnection) {
    commitTableShape ??= connection
      .execute('PRAGMA table_info(specter_event_commits)')
      .then((result) => {
        const columns = new Set(
          result.rows.map((row) =>
            requireString(row.name, 'Event commit table column name'),
          ),
        )
        if (columns.has('commit_version')) return 'versioned' as const
        if (columns.has('idempotency_key') && columns.has('last_event_order')) {
          return 'legacy' as const
        }
        throw new Error('Unsupported SQLite Event commit table schema')
      })
    return commitTableShape
  }

  function fromRow(row: Record<string, unknown>): PersistedEvent {
    const recordedAt = requireString(row.recorded_at, 'recorded time')
    if (Number.isNaN(Date.parse(recordedAt))) {
      throw new Error('Expected SQLite recorded time to be ISO-8601')
    }
    return {
      id: requireString(row.id, 'event id'),
      order: requireNumber(row.event_order, 'event order'),
      type: requireString(row.type, 'event type'),
      payload: codec.decode(requireString(row.payload, 'event payload')),
      recordedAt,
      keys: storedKeys(row.event_keys),
    }
  }

  async function query(
    connection: SqliteConnection,
    afterOrder: number,
    eventTypes: readonly string[],
    page: EventLogPage,
  ) {
    if (!eventTypes.length) return []
    const result = await connection.execute({
      sql: `SELECT ${eventColumns}
        FROM specter_events e
        WHERE event_order > ?
          AND type IN (${eventTypes.map(() => '?').join(', ')})
        ORDER BY event_order ASC
        LIMIT ?`,
      args: [afterOrder, ...eventTypes, page.limit ?? -1],
    })
    return result.rows.map((row) => fromRow(row as Record<string, unknown>))
  }

  /**
   * The order of the first Event appended after the condition's read that it
   * covers, or undefined when there is none. Checked in SQL, from the stored
   * keys.
   */
  async function staleOrder(
    connection: SqliteConnection,
    condition: EventLogAppendCondition,
  ): Promise<number | undefined> {
    if (condition.eventTypes.length === 0) return undefined
    const types = condition.eventTypes.map(() => '?').join(', ')
    if (!condition.keys) {
      const result = await connection.execute({
        sql: `SELECT event_order FROM specter_events
          WHERE event_order > ? AND type IN (${types})
          ORDER BY event_order ASC LIMIT 1`,
        args: [condition.afterOrder, ...condition.eventTypes],
      })
      const row = result.rows[0]
      return row
        ? requireNumber(row.event_order, 'stale event order')
        : undefined
    }
    const keys = Object.entries(condition.keys).filter(
      ([, values]) => values.length > 0,
    )
    if (keys.length === 0) return undefined
    const result = await connection.execute({
      sql: `SELECT k.event_order FROM specter_event_keys k
        JOIN specter_events e ON e.event_order = k.event_order
        WHERE k.event_order > ? AND e.type IN (${types})
          AND (${keys
            .map(
              ([, values]) =>
                `(k.name = ? AND k.value IN (${values.map(() => '?').join(', ')}))`,
            )
            .join(' OR ')})
        ORDER BY k.event_order ASC LIMIT 1`,
      args: [
        condition.afterOrder,
        ...condition.eventTypes,
        ...keys.flatMap(([name, values]) => [name, ...values]),
      ],
    })
    const row = result.rows[0]
    return row ? requireNumber(row.event_order, 'stale event order') : undefined
  }

  async function readKey(
    connection: SqliteConnection,
    key: EventKey,
    page: EventLogKeyPage,
  ) {
    const result = await connection.execute({
      sql: `SELECT ${eventColumns}
        FROM specter_event_keys k
        JOIN specter_events e ON e.event_order = k.event_order
        WHERE k.name = ? AND k.value = ? AND k.event_order > ?
        ORDER BY k.event_order ASC
        LIMIT ?`,
      args: [key.name, key.value, page.afterOrder ?? 0, page.limit ?? -1],
    })
    return result.rows.map((row) => fromRow(row as Record<string, unknown>))
  }

  async function currentVersion(connection: SqliteConnection) {
    const result = await connection.execute(
      'SELECT COALESCE(MAX(event_order), 0) AS version FROM specter_events',
    )
    return requireNumber(result.rows[0]?.version, 'Event Log version')
  }

  async function findCommit(
    connection: SqliteConnection,
    idempotencyKey: string,
  ): Promise<EventLogCommit | undefined> {
    const receipt = await connection.execute({
      sql: `SELECT idempotency_key, fingerprint, first_event_order,
          last_event_order, committed_at
        FROM specter_event_commits
        WHERE idempotency_key = ?`,
      args: [idempotencyKey],
    })
    const row = receipt.rows[0]
    if (!row) return undefined
    return commitFromRow(connection, row as Record<string, unknown>)
  }

  async function commitFromRow(
    connection: SqliteConnection,
    row: Record<string, unknown>,
  ): Promise<EventLogCommit> {
    const firstOrder = requireNumber(
      row.first_event_order,
      'first commit event order',
    )
    const version = requireNumber(row.last_event_order, 'commit version')
    const committedAt = requireString(row.committed_at, 'commit time')
    if (Number.isNaN(Date.parse(committedAt))) {
      throw new Error('Expected SQLite commit time to be ISO-8601')
    }
    const events = await connection.execute({
      sql: `SELECT ${eventColumns}
        FROM specter_events e
        WHERE event_order BETWEEN ? AND ?
        ORDER BY event_order ASC`,
      args: [firstOrder, version],
    })
    return {
      events: events.rows.map((event) =>
        fromRow(event as Record<string, unknown>),
      ),
      version,
      committedAt,
      idempotencyKey:
        row.idempotency_key === null
          ? undefined
          : requireString(row.idempotency_key, 'commit idempotency key'),
      fingerprint:
        row.fingerprint === null
          ? undefined
          : requireString(row.fingerprint, 'commit fingerprint'),
    }
  }

  async function commitsAfter(
    connection: SqliteConnection,
    afterVersion: number,
    page: EventLogPage,
  ): Promise<readonly EventLogCommit[]> {
    const tableShape = await getCommitTableShape(connection)
    const versionColumn =
      tableShape === 'versioned' ? 'commit_version' : 'last_event_order'
    const result = await connection.execute({
      sql: `SELECT idempotency_key, fingerprint, first_event_order,
          last_event_order, committed_at
        FROM specter_event_commits
        WHERE ${versionColumn} > ?
        ORDER BY ${versionColumn} ASC
        LIMIT ?`,
      args: [afterVersion, page.limit ?? -1],
    })
    return Promise.all(
      result.rows.map((row) =>
        commitFromRow(connection, row as Record<string, unknown>),
      ),
    )
  }

  async function append(
    connection: SqliteConnection,
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

    const tableShape = await getCommitTableShape(connection)

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
      // The host's ID and time when it supplied them. The ID column is
      // unique, so an ID already in the log fails the append.
      const id = draft.id ?? eventId()
      const recordedAt = draft.recordedAt ?? now().toISOString()
      if (Number.isNaN(Date.parse(recordedAt))) {
        throw new Error('Event recordedAt must be an ISO-8601 timestamp')
      }
      const inserted = await connection.execute({
        sql: `INSERT INTO specter_events (id, type, payload, recorded_at)
          VALUES (?, ?, ?, ?)
          RETURNING event_order`,
        args: [id, draft.type, codec.encode(draft.payload), recordedAt],
      })
      const order = requireNumber(
        inserted.rows[0]?.event_order,
        'inserted event order',
      )
      const keys = Object.entries(draft.keys)
      if (keys.length > 0) {
        await connection.execute({
          sql: `INSERT INTO specter_event_keys (event_order, name, value)
            VALUES ${keys.map(() => '(?, ?, ?)').join(', ')}`,
          args: keys.flatMap(([name, value]) => [order, name, value]),
        })
      }
      events.push({
        type: draft.type,
        payload: draft.payload,
        id,
        order,
        recordedAt,
        keys: { ...draft.keys },
      })
    }
    const committedVersion = events.at(-1)?.order ?? version
    const committedAt = now().toISOString()
    if (tableShape === 'versioned') {
      await connection.execute({
        sql: `INSERT INTO specter_event_commits (
            commit_version,
            idempotency_key,
            fingerprint,
            first_event_order,
            last_event_order,
            committed_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          committedVersion,
          appendOptions.idempotencyKey ?? null,
          appendOptions.fingerprint ?? null,
          events[0]?.order ?? version,
          committedVersion,
          committedAt,
        ],
      })
    } else {
      await connection.execute({
        sql: `INSERT INTO specter_event_commits (
            idempotency_key,
            fingerprint,
            first_event_order,
            last_event_order,
            committed_at
          ) VALUES (?, ?, ?, ?, ?)`,
        args: [
          appendOptions.idempotencyKey ?? null,
          appendOptions.fingerprint ?? null,
          events[0]?.order ?? version,
          committedVersion,
          committedAt,
        ],
      })
    }
    return {
      events,
      version: committedVersion,
      committedAt,
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
    query: (afterOrder, eventTypes, page = {}) =>
      context.use((connection) =>
        attempt('query', () => query(connection, afterOrder, eventTypes, page)),
      ),
    currentVersion: context.use((connection) =>
      attempt('currentVersion', () => currentVersion(connection)),
    ),
    readKey: (key, page = {}) =>
      context.use((connection) =>
        attempt('readKey', () => readKey(connection, key, page)),
      ),
    commitsAfter: (afterVersion, page = {}) =>
      context.use((connection) =>
        attempt('commitsAfter', () =>
          commitsAfter(connection, afterVersion, page),
        ),
      ),
    findCommit: (idempotencyKey) =>
      context.use((connection) =>
        attempt('findCommit', () => findCommit(connection, idempotencyKey)),
      ),
    append: (drafts, appendOptions) =>
      context
        .transaction((connection) =>
          attempt('append', () => append(connection, drafts, appendOptions)),
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

export function createSqliteEventLogLayer(
  client: Client,
  options: SqliteEventLogOptions = {},
): Layer.Layer<EventLog> {
  return Layer.succeed(EventLog, createSqliteEventLogService(client, options))
}

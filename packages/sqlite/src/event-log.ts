import { randomUUID } from 'node:crypto'

import type { Client } from '@libsql/client'
import {
  SpecterIdempotencyConflictError,
  SpecterVersionConflictError,
  type EventDraft,
  type EventLogAdapter,
  type EventLogAppendOptions,
  type EventLogAppendResult,
  type EventLogCommit,
  type EventLogTransaction,
  type PersistedEvent,
} from '@specter-ts/core'

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

export type SqliteEventLog = EventLogAdapter & {
  readonly context: SqliteDatabaseContext
}

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
        idempotency_key TEXT PRIMARY KEY,
        fingerprint TEXT,
        first_event_order INTEGER NOT NULL,
        last_event_order INTEGER NOT NULL,
        committed_at TEXT NOT NULL
      )`,
    ],
    'write',
  )
}

export function createSqliteEventLog(
  client: Client,
  options: SqliteEventLogOptions = {},
): SqliteEventLog {
  const context = options.context ?? createSqliteDatabaseContext(client)
  const eventId = options.eventId ?? randomUUID
  const now = options.now ?? (() => new Date())
  const codec = options.codec ?? jsonCodec

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
    }
  }

  async function query(
    connection: SqliteConnection,
    afterOrder: number,
    eventTypes: readonly string[],
  ) {
    if (!eventTypes.length) return []
    const result = await connection.execute({
      sql: `SELECT id, event_order, type, payload, recorded_at
        FROM specter_events
        WHERE event_order > ?
          AND type IN (${eventTypes.map(() => '?').join(', ')})
        ORDER BY event_order ASC`,
      args: [afterOrder, ...eventTypes],
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
      sql: `SELECT fingerprint, first_event_order, last_event_order
        FROM specter_event_commits
        WHERE idempotency_key = ?`,
      args: [idempotencyKey],
    })
    const row = receipt.rows[0]
    if (!row) return undefined
    const firstOrder = requireNumber(
      row.first_event_order,
      'first commit event order',
    )
    const version = requireNumber(row.last_event_order, 'commit version')
    const events = await connection.execute({
      sql: `SELECT id, event_order, type, payload, recorded_at
        FROM specter_events
        WHERE event_order BETWEEN ? AND ?
        ORDER BY event_order ASC`,
      args: [firstOrder, version],
    })
    return {
      events: events.rows.map((event) =>
        fromRow(event as Record<string, unknown>),
      ),
      version,
      idempotencyKey,
      fingerprint:
        row.fingerprint === null
          ? undefined
          : requireString(row.fingerprint, 'commit fingerprint'),
    }
  }

  async function append(
    connection: SqliteConnection,
    drafts: readonly EventDraft[],
    appendOptions: EventLogAppendOptions = {},
  ): Promise<EventLogAppendResult> {
    const existing = appendOptions.idempotencyKey
      ? await findCommit(connection, appendOptions.idempotencyKey)
      : undefined
    if (existing) {
      if (existing.fingerprint !== appendOptions.fingerprint) {
        throw new SpecterIdempotencyConflictError(
          appendOptions.idempotencyKey as string,
        )
      }
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

    const events: PersistedEvent[] = []
    for (const draft of drafts) {
      const id = eventId()
      const recordedAt = now().toISOString()
      const inserted = await connection.execute({
        sql: `INSERT INTO specter_events (id, type, payload, recorded_at)
          VALUES (?, ?, ?, ?)
          RETURNING event_order`,
        args: [id, draft.type, codec.encode(draft.payload), recordedAt],
      })
      events.push({
        ...draft,
        id,
        order: requireNumber(
          inserted.rows[0]?.event_order,
          'inserted event order',
        ),
        recordedAt,
      })
    }
    const committedVersion = events.at(-1)?.order ?? version
    if (appendOptions.idempotencyKey) {
      await connection.execute({
        sql: `INSERT INTO specter_event_commits (
            idempotency_key,
            fingerprint,
            first_event_order,
            last_event_order,
            committed_at
          ) VALUES (?, ?, ?, ?, ?)`,
        args: [
          appendOptions.idempotencyKey,
          appendOptions.fingerprint ?? null,
          events[0]?.order ?? version,
          committedVersion,
          now().toISOString(),
        ],
      })
    }
    return {
      events,
      version: committedVersion,
      idempotencyKey: appendOptions.idempotencyKey,
      fingerprint: appendOptions.fingerprint,
      duplicate: false,
    }
  }

  function appendAtomically(
    drafts: readonly EventDraft[],
    appendOptions?: EventLogAppendOptions,
  ) {
    return context.serialize(() =>
      context.transaction((connection) =>
        append(connection, drafts, appendOptions),
      ),
    )
  }

  function scoped(baseVersion: number): EventLogTransaction {
    return {
      query: (afterOrder, eventTypes) => query(client, afterOrder, eventTypes),
      currentVersion: async () => baseVersion,
      findCommit: (idempotencyKey) => findCommit(client, idempotencyKey),
      append: (drafts, appendOptions) =>
        context.transaction((connection) =>
          append(connection, drafts, {
            ...appendOptions,
            expectedVersion: appendOptions?.expectedVersion ?? baseVersion,
          }),
        ),
    }
  }

  return {
    context,
    query: (afterOrder, eventTypes) =>
      query(context.connection(), afterOrder, eventTypes),
    currentVersion: () => currentVersion(context.connection()),
    findCommit: (idempotencyKey) =>
      findCommit(context.connection(), idempotencyKey),
    append: appendAtomically,
    transaction: (run) =>
      context.serialize(async () => {
        const baseVersion = await currentVersion(client)
        return run(scoped(baseVersion))
      }),
  }
}

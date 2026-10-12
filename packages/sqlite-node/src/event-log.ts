import { randomUUID } from 'node:crypto'

import {
  EventLog,
  EventLogFailure,
  SpecterVersionConflictError,
  type EventLogAppendCondition,
  type EventLogAppendOptions,
  type EventLogCommit,
  type EventLogDraft,
  type EventLogService,
  type PersistedEvent,
} from '@specter-ts/core'
import { Effect, Layer } from 'effect'

import {
  type NodeSqliteContext,
  requireNumber,
  requireString,
} from './database'

export type NodeSqliteEventLogOptions = {
  readonly eventId?: () => string
  readonly now?: () => Date
}

export function prepareNodeSqliteEventLog(context: NodeSqliteContext) {
  context.database.exec(`
    CREATE TABLE IF NOT EXISTS specter_events (
      event_order INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS specter_events_type_order_idx
      ON specter_events(type, event_order);
    CREATE TABLE IF NOT EXISTS specter_event_commits (
      commit_version INTEGER PRIMARY KEY,
      idempotency_key TEXT UNIQUE,
      fingerprint TEXT,
      first_event_order INTEGER NOT NULL,
      last_event_order INTEGER NOT NULL,
      committed_at TEXT NOT NULL
    );
    -- Each Event's named keys, as core derived them when it was appended.
    CREATE TABLE IF NOT EXISTS specter_event_keys (
      event_order INTEGER NOT NULL REFERENCES specter_events(event_order),
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (event_order, name)
    );
    CREATE INDEX IF NOT EXISTS specter_event_keys_name_value_order_idx
      ON specter_event_keys(name, value, event_order);
  `)
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

export function createNodeSqliteEventLogService(
  context: NodeSqliteContext,
  options: NodeSqliteEventLogOptions = {},
): EventLogService {
  const eventId = options.eventId ?? randomUUID
  const now = options.now ?? (() => new Date())

  function decodeRow(row: Record<string, unknown>): PersistedEvent {
    const recordedAt = requireString(row.recorded_at, 'recorded time')
    if (Number.isNaN(Date.parse(recordedAt))) {
      throw new Error('Expected SQLite recorded time to be ISO-8601')
    }
    const order = requireNumber(row.event_order, 'event order')
    if (!Number.isSafeInteger(order)) throw new Error('Unsafe Event order')
    return {
      id: requireString(row.id, 'event id'),
      order,
      type: requireString(row.type, 'event type'),
      payload: JSON.parse(requireString(row.payload, 'event payload')),
      recordedAt,
      keys: storedKeys(row.event_keys),
    }
  }

  function query(
    afterOrder: number,
    eventTypes: readonly string[],
    limit: number,
  ) {
    if (!eventTypes.length) return []
    const placeholders = eventTypes.map(() => '?').join(', ')
    return context.database
      .prepare(
        `SELECT ${eventColumns}
         FROM specter_events e
         WHERE event_order > ? AND type IN (${placeholders})
         ORDER BY event_order ASC
         LIMIT ?`,
      )
      .all(afterOrder, ...eventTypes, limit)
      .map((row) => decodeRow(row as Record<string, unknown>))
  }

  /**
   * The order of the first Event appended after the condition's read that it
   * covers, or undefined when there is none. Checked in SQL, from the stored
   * keys.
   */
  function staleOrder(condition: EventLogAppendCondition) {
    if (condition.eventTypes.length === 0) return undefined
    const types = condition.eventTypes.map(() => '?').join(', ')
    if (!condition.keys) {
      const row = context.database
        .prepare(
          `SELECT event_order FROM specter_events
           WHERE event_order > ? AND type IN (${types})
           ORDER BY event_order ASC LIMIT 1`,
        )
        .get(condition.afterOrder, ...condition.eventTypes) as
        | Record<string, unknown>
        | undefined
      return row
        ? requireNumber(row.event_order, 'stale event order')
        : undefined
    }
    const keys = Object.entries(condition.keys).filter(
      ([, values]) => values.length > 0,
    )
    if (keys.length === 0) return undefined
    const row = context.database
      .prepare(
        `SELECT k.event_order FROM specter_event_keys k
         JOIN specter_events e ON e.event_order = k.event_order
         WHERE k.event_order > ? AND e.type IN (${types})
           AND (${keys
             .map(
               ([, values]) =>
                 `(k.name = ? AND k.value IN (${values.map(() => '?').join(', ')}))`,
             )
             .join(' OR ')})
         ORDER BY k.event_order ASC LIMIT 1`,
      )
      .get(
        condition.afterOrder,
        ...condition.eventTypes,
        ...keys.flatMap(([name, values]) => [name, ...values]),
      ) as Record<string, unknown> | undefined
    return row ? requireNumber(row.event_order, 'stale event order') : undefined
  }

  function readKey(
    name: string,
    value: string,
    afterOrder: number,
    limit: number,
  ) {
    return context.database
      .prepare(
        `SELECT ${eventColumns}
         FROM specter_event_keys k
         JOIN specter_events e ON e.event_order = k.event_order
         WHERE k.name = ? AND k.value = ? AND k.event_order > ?
         ORDER BY k.event_order ASC
         LIMIT ?`,
      )
      .all(name, value, afterOrder, limit)
      .map((row) => decodeRow(row as Record<string, unknown>))
  }

  function currentVersion() {
    const row = context.database
      .prepare(
        'SELECT COALESCE(MAX(event_order), 0) AS version FROM specter_events',
      )
      .get() as Record<string, unknown>
    return requireNumber(row.version, 'Event Log version')
  }

  function findCommit(key: string): EventLogCommit | undefined {
    const row = context.database
      .prepare(
        `SELECT idempotency_key, fingerprint, first_event_order,
           last_event_order, committed_at
         FROM specter_event_commits WHERE idempotency_key = ?`,
      )
      .get(key) as Record<string, unknown> | undefined
    if (!row) return undefined
    return commitFromRow(row)
  }

  function commitFromRow(row: Record<string, unknown>): EventLogCommit {
    const first = requireNumber(row.first_event_order, 'first Event order')
    const version = requireNumber(row.last_event_order, 'commit version')
    const committedAt = requireString(row.committed_at, 'commit time')
    if (Number.isNaN(Date.parse(committedAt))) {
      throw new Error('Expected SQLite commit time to be ISO-8601')
    }
    const events = context.database
      .prepare(
        `SELECT ${eventColumns}
         FROM specter_events e WHERE event_order BETWEEN ? AND ?
         ORDER BY event_order ASC`,
      )
      .all(first, version)
      .map((event) => decodeRow(event as Record<string, unknown>))
    return {
      events,
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

  function commitsAfter(
    afterVersion: number,
    limit: number,
  ): readonly EventLogCommit[] {
    return context.database
      .prepare(
        `SELECT idempotency_key, fingerprint, first_event_order,
           last_event_order, committed_at
         FROM specter_event_commits WHERE commit_version > ?
         ORDER BY commit_version ASC
         LIMIT ?`,
      )
      .all(afterVersion, limit)
      .map((row) => commitFromRow(row as Record<string, unknown>))
  }

  function append(
    drafts: readonly EventLogDraft[],
    appendOptions: EventLogAppendOptions = {},
  ) {
    const existing = appendOptions.idempotencyKey
      ? findCommit(appendOptions.idempotencyKey)
      : undefined
    if (existing) {
      return { ...existing, duplicate: true as const }
    }
    if (drafts.length === 0) throw new Error('Event Log append requires Events')
    const version = currentVersion()
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
    const stale = unchanged && staleOrder(unchanged)
    if (unchanged && stale !== undefined) {
      throw new SpecterVersionConflictError(unchanged.afterOrder, stale)
    }
    const insert = context.database.prepare(
      'INSERT INTO specter_events (id, type, payload, recorded_at) VALUES (?, ?, ?, ?)',
    )
    const insertKey = context.database.prepare(
      'INSERT INTO specter_event_keys (event_order, name, value) VALUES (?, ?, ?)',
    )
    const events = drafts.map((draft): PersistedEvent => {
      // The host's ID and time when it supplied them. The ID column is
      // unique, so an ID already in the log fails the append.
      const id = draft.id ?? eventId()
      const recordedAt = draft.recordedAt ?? now().toISOString()
      if (Number.isNaN(Date.parse(recordedAt))) {
        throw new Error('Event recordedAt must be an ISO-8601 timestamp')
      }
      const payload = JSON.stringify(draft.payload)
      if (payload === undefined) throw new Error('Event payload must be JSON')
      const result = insert.run(id, draft.type, payload, recordedAt)
      const order = Number(result.lastInsertRowid)
      if (!Number.isSafeInteger(order)) throw new Error('Unsafe Event order')
      for (const [name, value] of Object.entries(draft.keys)) {
        insertKey.run(order, name, value)
      }
      return {
        type: draft.type,
        payload: draft.payload,
        id,
        order,
        recordedAt,
        keys: { ...draft.keys },
      }
    })
    const committedVersion = events.at(-1)?.order ?? version
    const committedAt = now().toISOString()
    context.database
      .prepare(
        `INSERT INTO specter_event_commits (
          commit_version, idempotency_key, fingerprint, first_event_order,
          last_event_order, committed_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        committedVersion,
        appendOptions.idempotencyKey ?? null,
        appendOptions.fingerprint ?? null,
        events[0]?.order ?? version,
        committedVersion,
        committedAt,
      )
    return {
      events,
      version: committedVersion,
      committedAt,
      idempotencyKey: appendOptions.idempotencyKey,
      fingerprint: appendOptions.fingerprint,
      duplicate: false as const,
    }
  }

  return {
    capabilities: { scopedAppend: true, keyedRead: true },
    query: (afterOrder, eventTypes, page = {}) =>
      Effect.try({
        try: () => query(afterOrder, eventTypes, page.limit ?? -1),
        catch: (cause) => new EventLogFailure('query', cause),
      }),
    currentVersion: Effect.try({
      try: currentVersion,
      catch: (cause) => new EventLogFailure('currentVersion', cause),
    }),
    readKey: (key, page = {}) =>
      Effect.try({
        try: () =>
          readKey(key.name, key.value, page.afterOrder ?? 0, page.limit ?? -1),
        catch: (cause) => new EventLogFailure('readKey', cause),
      }),
    commitsAfter: (afterVersion, page = {}) =>
      Effect.try({
        try: () => commitsAfter(afterVersion, page.limit ?? -1),
        catch: (cause) => new EventLogFailure('commitsAfter', cause),
      }),
    findCommit: (key) =>
      Effect.try({
        try: () => findCommit(key),
        catch: (cause) => new EventLogFailure('findCommit', cause),
      }),
    append: (drafts, appendOptions) =>
      context.transactionEffect(
        Effect.try({
          try: () => append(drafts, appendOptions),
          catch: (cause) => new EventLogFailure('append', cause),
        }),
      ),
  }
}

export function createNodeSqliteEventLogLayer(
  context: NodeSqliteContext,
  options: NodeSqliteEventLogOptions = {},
): Layer.Layer<EventLog> {
  return Layer.sync(EventLog, () =>
    createNodeSqliteEventLogService(context, options),
  )
}

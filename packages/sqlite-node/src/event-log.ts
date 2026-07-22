import { randomUUID } from 'node:crypto'

import {
  EventLog,
  EventLogFailure,
  SpecterIdempotencyConflictError,
  SpecterVersionConflictError,
  type EventDraft,
  type EventLogAppendOptions,
  type EventLogCommit,
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
  `)
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
    }
  }

  function query(afterOrder: number, eventTypes: readonly string[]) {
    if (!eventTypes.length) return []
    const placeholders = eventTypes.map(() => '?').join(', ')
    return context.database
      .prepare(
        `SELECT id, event_order, type, payload, recorded_at
         FROM specter_events
         WHERE event_order > ? AND type IN (${placeholders})
         ORDER BY event_order ASC`,
      )
      .all(afterOrder, ...eventTypes)
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
        `SELECT id, event_order, type, payload, recorded_at
         FROM specter_events WHERE event_order BETWEEN ? AND ?
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

  function commitsAfter(afterVersion: number): readonly EventLogCommit[] {
    return context.database
      .prepare(
        `SELECT idempotency_key, fingerprint, first_event_order,
           last_event_order, committed_at
         FROM specter_event_commits WHERE commit_version > ?
         ORDER BY commit_version ASC`,
      )
      .all(afterVersion)
      .map((row) => commitFromRow(row as Record<string, unknown>))
  }

  function append(
    drafts: readonly EventDraft[],
    appendOptions: EventLogAppendOptions = {},
  ) {
    const existing = appendOptions.idempotencyKey
      ? findCommit(appendOptions.idempotencyKey)
      : undefined
    if (existing) {
      if (existing.fingerprint !== appendOptions.fingerprint) {
        throw new SpecterIdempotencyConflictError(
          appendOptions.idempotencyKey as string,
        )
      }
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
    const insert = context.database.prepare(
      'INSERT INTO specter_events (id, type, payload, recorded_at) VALUES (?, ?, ?, ?)',
    )
    const events = drafts.map((draft) => {
      const id = eventId()
      const recordedAt = now().toISOString()
      const payload = JSON.stringify(draft.payload)
      if (payload === undefined) throw new Error('Event payload must be JSON')
      const result = insert.run(id, draft.type, payload, recordedAt)
      const order = Number(result.lastInsertRowid)
      if (!Number.isSafeInteger(order)) throw new Error('Unsafe Event order')
      return { ...draft, id, order, recordedAt }
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
    query: (afterOrder, eventTypes) =>
      Effect.try({
        try: () => query(afterOrder, eventTypes),
        catch: (cause) => new EventLogFailure('query', cause),
      }),
    currentVersion: Effect.try({
      try: currentVersion,
      catch: (cause) => new EventLogFailure('currentVersion', cause),
    }),
    commitsAfter: (afterVersion) =>
      Effect.try({
        try: () => commitsAfter(afterVersion),
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

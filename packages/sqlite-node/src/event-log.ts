import { randomUUID } from 'node:crypto'

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
      idempotency_key TEXT PRIMARY KEY,
      fingerprint TEXT,
      first_event_order INTEGER NOT NULL,
      last_event_order INTEGER NOT NULL,
      committed_at TEXT NOT NULL
    );
  `)
}

export function createNodeSqliteEventLog(
  context: NodeSqliteContext,
  options: NodeSqliteEventLogOptions = {},
): EventLogAdapter {
  const eventId = options.eventId ?? randomUUID
  const now = options.now ?? (() => new Date())

  function decodeRow(row: Record<string, unknown>): PersistedEvent {
    const recordedAt = requireString(row.recorded_at, 'recorded time')
    if (Number.isNaN(Date.parse(recordedAt))) {
      throw new Error('Expected SQLite recorded time to be ISO-8601')
    }
    return {
      id: requireString(row.id, 'event id'),
      order: requireNumber(row.event_order, 'event order'),
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

  function findCommit(idempotencyKey: string): EventLogCommit | undefined {
    const row = context.database
      .prepare(
        `SELECT fingerprint, first_event_order, last_event_order
          FROM specter_event_commits WHERE idempotency_key = ?`,
      )
      .get(idempotencyKey) as Record<string, unknown> | undefined
    if (!row) return undefined
    const firstOrder = requireNumber(
      row.first_event_order,
      'first commit Event order',
    )
    const version = requireNumber(row.last_event_order, 'commit version')
    const events = context.database
      .prepare(
        `SELECT id, event_order, type, payload, recorded_at
          FROM specter_events WHERE event_order BETWEEN ? AND ?
          ORDER BY event_order ASC`,
      )
      .all(firstOrder, version)
      .map((event) => decodeRow(event as Record<string, unknown>))
    return {
      events,
      version,
      idempotencyKey,
      fingerprint:
        row.fingerprint === null
          ? undefined
          : requireString(row.fingerprint, 'commit fingerprint'),
    }
  }

  function append(
    drafts: readonly EventDraft[],
    appendOptions: EventLogAppendOptions = {},
  ): EventLogAppendResult {
    const existing = appendOptions.idempotencyKey
      ? findCommit(appendOptions.idempotencyKey)
      : undefined
    if (existing) {
      if (existing.fingerprint !== appendOptions.fingerprint) {
        throw new SpecterIdempotencyConflictError(
          appendOptions.idempotencyKey as string,
        )
      }
      return { ...existing, duplicate: true }
    }
    if (!drafts.length) throw new Error('Event Log append requires Events')

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
      `INSERT INTO specter_events (id, type, payload, recorded_at)
        VALUES (?, ?, ?, ?)`,
    )
    const events = drafts.map((draft) => {
      const id = eventId()
      const recordedAt = now().toISOString()
      const payload = JSON.stringify(draft.payload)
      if (payload === undefined) {
        throw new Error('SQLite Event payload must be JSON-serializable')
      }
      const result = insert.run(id, draft.type, payload, recordedAt)
      return {
        ...draft,
        id,
        order: Number(result.lastInsertRowid),
        recordedAt,
      }
    })
    const committedVersion = events.at(-1)?.order ?? version
    if (appendOptions.idempotencyKey) {
      context.database
        .prepare(
          `INSERT INTO specter_event_commits (
            idempotency_key, fingerprint, first_event_order,
            last_event_order, committed_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          appendOptions.idempotencyKey,
          appendOptions.fingerprint ?? null,
          events[0]?.order ?? version,
          committedVersion,
          now().toISOString(),
        )
    }
    return {
      events,
      version: committedVersion,
      idempotencyKey: appendOptions.idempotencyKey,
      fingerprint: appendOptions.fingerprint,
      duplicate: false,
    }
  }

  const scoped: EventLogTransaction = {
    query: async (afterOrder, eventTypes) => query(afterOrder, eventTypes),
    currentVersion: async () => currentVersion(),
    findCommit: async (key) => findCommit(key),
    append: async (drafts, appendOptions) => append(drafts, appendOptions),
  }

  return {
    query: (afterOrder, eventTypes) =>
      context.run(() => query(afterOrder, eventTypes)),
    currentVersion: () => context.run(currentVersion),
    findCommit: (key) => context.run(() => findCommit(key)),
    append: (drafts, appendOptions) =>
      context.transaction(() => append(drafts, appendOptions)),
    transaction: (run) => context.transaction(() => run(scoped)),
  }
}

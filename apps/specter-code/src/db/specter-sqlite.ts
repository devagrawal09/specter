import { AsyncLocalStorage } from 'node:async_hooks'

import type { Client, Transaction } from '@libsql/client/sqlite3'
import {
  SpecterIdempotencyConflictError,
  SpecterVersionConflictError,
  type EventDraft,
  type EventLogAdapter,
  type EventLogAppendOptions,
  type EventLogCommit,
  type PersistedEvent,
} from '@specter-ts/core'

export type SqliteDb = Client | Transaction

export type SpecterSqliteEventProjector = (
  db: SqliteDb,
  event: SpecterSqliteEventRecord,
) => Promise<void> | void

export type SpecterSqliteEventRecord = {
  id: string
  order: number
  type: string
  payload: unknown
  recordedAt: string
}

const scopedSqliteDb = new AsyncLocalStorage<SqliteDb>()
let specterSqliteEventProjector: SpecterSqliteEventProjector | undefined

export function setSpecterSqliteEventProjector(
  projector: SpecterSqliteEventProjector | undefined,
) {
  specterSqliteEventProjector = projector
}

export async function prepareSpecterSqlite(db: Client) {
  await db.execute({ sql: 'PRAGMA journal_mode = WAL', args: [] })
  await db.execute({ sql: 'PRAGMA busy_timeout = 5000', args: [] })

  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS specter_events (
      event_order INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    )`,
      `CREATE INDEX IF NOT EXISTS specter_events_order_idx
      ON specter_events(event_order)`,
      `CREATE TABLE IF NOT EXISTS specter_event_commits (
      idempotency_key TEXT PRIMARY KEY,
      fingerprint TEXT,
      first_event_order INTEGER NOT NULL,
      last_event_order INTEGER NOT NULL,
      committed_at TEXT NOT NULL
    )`,
      `CREATE TABLE IF NOT EXISTS specter_slice_states (
      slice_name TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      last_applied_order INTEGER NOT NULL
    )`,
      `CREATE TABLE IF NOT EXISTS specter_code_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      directory TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
      `CREATE INDEX IF NOT EXISTS specter_code_sessions_workspace_idx
      ON specter_code_sessions(workspace_id, updated_at)`,
      `CREATE TABLE IF NOT EXISTS specter_code_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      author_json TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      event_order INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES specter_code_sessions(id) ON DELETE CASCADE
    )`,
      `CREATE INDEX IF NOT EXISTS specter_code_messages_session_idx
      ON specter_code_messages(session_id, event_order)`,
      `CREATE TABLE IF NOT EXISTS specter_code_message_parts (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      part_order INTEGER NOT NULL,
      type TEXT NOT NULL,
      content TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      event_order INTEGER NOT NULL,
      FOREIGN KEY(message_id) REFERENCES specter_code_messages(id) ON DELETE CASCADE,
      FOREIGN KEY(session_id) REFERENCES specter_code_sessions(id) ON DELETE CASCADE
    )`,
      `CREATE INDEX IF NOT EXISTS specter_code_message_parts_message_idx
      ON specter_code_message_parts(message_id, part_order)`,
      `CREATE TABLE IF NOT EXISTS specter_code_tool_calls (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT,
      tool_name TEXT NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      event_order INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES specter_code_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(message_id) REFERENCES specter_code_messages(id) ON DELETE SET NULL
    )`,
      `CREATE INDEX IF NOT EXISTS specter_code_tool_calls_session_idx
      ON specter_code_tool_calls(session_id, event_order)`,
      `CREATE TABLE IF NOT EXISTS specter_code_permissions (
      request_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      tool_call_id TEXT,
      tool_name TEXT NOT NULL,
      permission TEXT NOT NULL,
      target TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'ask',
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT,
      requested_at TEXT NOT NULL,
      replied_at TEXT,
      replied_by_json TEXT,
      FOREIGN KEY(session_id) REFERENCES specter_code_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(tool_call_id) REFERENCES specter_code_tool_calls(id) ON DELETE SET NULL
    )`,
      `CREATE INDEX IF NOT EXISTS specter_code_permissions_session_status_idx
      ON specter_code_permissions(session_id, status, requested_at)`,
      `CREATE TABLE IF NOT EXISTS specter_code_todos (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT,
      position INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      event_order INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES specter_code_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(message_id) REFERENCES specter_code_messages(id) ON DELETE CASCADE
    )`,
      `CREATE INDEX IF NOT EXISTS specter_code_todos_session_idx
      ON specter_code_todos(session_id, position)`,
      `CREATE TABLE IF NOT EXISTS specter_code_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      before_content TEXT,
      after_content TEXT,
      created_at TEXT NOT NULL,
      event_order INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES specter_code_sessions(id) ON DELETE CASCADE
    )`,
      `CREATE INDEX IF NOT EXISTS specter_code_snapshots_session_idx
      ON specter_code_snapshots(session_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS specter_code_artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT,
      content_json TEXT,
      created_at TEXT NOT NULL,
      event_order INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES specter_code_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(message_id) REFERENCES specter_code_messages(id) ON DELETE SET NULL
    )`,
      `CREATE INDEX IF NOT EXISTS specter_code_artifacts_session_idx
      ON specter_code_artifacts(session_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS specter_code_pty_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      shell TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      last_output_at TEXT,
      FOREIGN KEY(session_id) REFERENCES specter_code_sessions(id) ON DELETE CASCADE
    )`,
      `CREATE INDEX IF NOT EXISTS specter_code_pty_sessions_session_idx
      ON specter_code_pty_sessions(session_id, started_at)`,
    ],
    'write',
  )
}

export function runWithSqliteDb<T>(db: SqliteDb, run: () => Promise<T>) {
  return scopedSqliteDb.run(db, run)
}

export function hasSqliteDbBinding() {
  return scopedSqliteDb.getStore() !== undefined
}

export async function querySpecterSqliteEvents(
  input: {
    afterOrder?: number
    limit?: number
    eventTypes?: readonly string[]
  } = {},
): Promise<SpecterSqliteEventRecord[]> {
  const afterOrder = input.afterOrder ?? 0
  const limit = input.limit ?? 500
  if (!Number.isInteger(afterOrder) || afterOrder < 0) {
    throw new Error('afterOrder must be a non-negative integer')
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer')
  }

  const args: Array<string | number> = [afterOrder]
  const typeClause = input.eventTypes?.length
    ? `AND type IN (${input.eventTypes.map(() => '?').join(', ')})`
    : ''
  if (input.eventTypes?.length) args.push(...input.eventTypes)
  args.push(limit)

  const result = await getDb().execute({
    sql: `
      SELECT id, event_order, type, payload, recorded_at
      FROM specter_events
      WHERE event_order > ? ${typeClause}
      ORDER BY event_order ASC
      LIMIT ?
    `,
    args,
  })

  return result.rows.map((row) => ({
    id: toStringValue(row.id),
    order: toNumber(row.event_order),
    type: toStringValue(row.type),
    payload: JSON.parse(toStringValue(row.payload)) as unknown,
    recordedAt: toStringValue(row.recorded_at),
  }))
}

export const sqliteEventLog: EventLogAdapter = {
  query: async (order, eventTypes) => {
    if (!eventTypes.length) return []

    const placeholders = eventTypes.map(() => '?').join(', ')
    const result = await getDb().execute({
      sql: `
        SELECT id, event_order, type, payload, recorded_at
        FROM specter_events
        WHERE event_order > ? AND type IN (${placeholders})
        ORDER BY event_order ASC
      `,
      args: [order, ...eventTypes],
    })

    return result.rows.map((row) => ({
      id: toStringValue(row.id),
      order: toNumber(row.event_order),
      type: toStringValue(row.type),
      payload: JSON.parse(toStringValue(row.payload)) as unknown,
      recordedAt: toStringValue(row.recorded_at),
    }))
  },
  currentVersion: async () => currentEventLogVersion(),
  findCommit: async (idempotencyKey) => findEventLogCommit(idempotencyKey),
  append: async (
    eventDrafts: readonly EventDraft[],
    options: EventLogAppendOptions = {},
  ) => {
    const existing = options.idempotencyKey
      ? await findEventLogCommit(options.idempotencyKey)
      : undefined
    if (existing) {
      if (existing.fingerprint !== options.fingerprint) {
        throw new SpecterIdempotencyConflictError(options.idempotencyKey ?? '')
      }
      return { ...existing, duplicate: true }
    }

    const version = await currentEventLogVersion()
    if (
      options.expectedVersion !== undefined &&
      options.expectedVersion !== version
    ) {
      throw new SpecterVersionConflictError(options.expectedVersion, version)
    }

    const persistedEvents: PersistedEvent[] = []

    for (const eventDraft of eventDrafts) {
      const id = crypto.randomUUID()
      const recordedAt = new Date()

      await getDb().execute({
        sql: `
          INSERT INTO specter_events (id, type, payload, recorded_at)
          VALUES (?, ?, ?, ?)
        `,
        args: [
          id,
          eventDraft.type,
          JSON.stringify(eventDraft.payload),
          recordedAt.toISOString(),
        ],
      })

      const result = await getDb().execute({
        sql: 'SELECT event_order FROM specter_events WHERE id = ?',
        args: [id],
      })
      const order = toNumber(result.rows[0]?.event_order)

      if (specterSqliteEventProjector) {
        await specterSqliteEventProjector(getDb(), {
          id,
          order,
          type: eventDraft.type,
          payload: eventDraft.payload,
          recordedAt: recordedAt.toISOString(),
        })
      }

      persistedEvents.push({
        ...eventDraft,
        id,
        order,
        recordedAt: recordedAt.toISOString(),
      })
    }

    const committedVersion = persistedEvents.at(-1)?.order ?? version
    if (options.idempotencyKey) {
      await getDb().execute({
        sql: `
          INSERT INTO specter_event_commits (
            idempotency_key,
            fingerprint,
            first_event_order,
            last_event_order,
            committed_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
        args: [
          options.idempotencyKey,
          options.fingerprint ?? null,
          persistedEvents[0]?.order ?? version,
          committedVersion,
          new Date().toISOString(),
        ],
      })
    }

    return {
      events: persistedEvents,
      version: committedVersion,
      idempotencyKey: options.idempotencyKey,
      fingerprint: options.fingerprint,
      duplicate: false,
    }
  },
  transaction: (run) => runInTransaction(() => run(sqliteEventLog)),
}

async function currentEventLogVersion() {
  const result = await getDb().execute(`
    SELECT COALESCE(MAX(event_order), 0) AS version
    FROM specter_events
  `)
  return toNumber(result.rows[0]?.version)
}

async function findEventLogCommit(
  idempotencyKey: string,
): Promise<EventLogCommit | undefined> {
  const receipt = await getDb().execute({
    sql: `
      SELECT fingerprint, first_event_order, last_event_order
      FROM specter_event_commits
      WHERE idempotency_key = ?
    `,
    args: [idempotencyKey],
  })
  const row = receipt.rows[0]
  if (!row) return undefined

  const firstOrder = toNumber(row.first_event_order)
  const version = toNumber(row.last_event_order)
  const result = await getDb().execute({
    sql: `
      SELECT id, event_order, type, payload, recorded_at
      FROM specter_events
      WHERE event_order BETWEEN ? AND ?
      ORDER BY event_order ASC
    `,
    args: [firstOrder, version],
  })

  return {
    events: result.rows.map((event) => ({
      id: toStringValue(event.id),
      order: toNumber(event.event_order),
      type: toStringValue(event.type),
      payload: JSON.parse(toStringValue(event.payload)) as unknown,
      recordedAt: toStringValue(event.recorded_at),
    })),
    version,
    idempotencyKey,
    fingerprint:
      row.fingerprint === null ? undefined : toStringValue(row.fingerprint),
  }
}

export function getBoundSqliteDb() {
  return getDb()
}

function getDb() {
  const db = scopedSqliteDb.getStore()

  if (!db) {
    throw new Error('No SQLite database is bound to the current async context')
  }

  return db
}

async function runInTransaction<T>(run: () => Promise<T>) {
  const db = getDb()

  if (isTransaction(db)) return run()

  const transaction = await db.transaction('write')

  try {
    return await scopedSqliteDb.run(transaction, async () => {
      const result = await run()
      await transaction.commit()
      return result
    })
  } catch (cause) {
    if (!transaction.closed) await transaction.rollback()
    throw cause
  } finally {
    transaction.close()
  }
}

function isTransaction(db: SqliteDb): db is Transaction {
  return !('transaction' in db)
}

function toStringValue(value: unknown) {
  if (typeof value !== 'string') {
    throw new Error(`Expected SQLite text value, got ${typeof value}`)
  }

  return value
}

function toNumber(value: unknown) {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') return Number(value)

  throw new Error(`Expected SQLite integer value, got ${typeof value}`)
}

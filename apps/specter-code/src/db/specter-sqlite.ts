import { AsyncLocalStorage } from 'node:async_hooks'

import type { Client, Transaction } from '@libsql/client/sqlite3'
import type {
  EventDraft,
  EventLogAdapter,
  SliceStore,
  SliceStoreAdapter,
} from '@specter-ts/core'

type SqliteDb = Client | Transaction

type SliceEntry<TState> = {
  state: TState
  order: number
}

const scopedSqliteDb = new AsyncLocalStorage<SqliteDb>()

export async function prepareSpecterSqlite(db: Client) {
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

export function createSqliteSliceStore<TState>(
  createState: () => TState,
): SliceStoreAdapter<TState> {
  return {
    get: async (sliceName) => createSliceStore(sliceName, createState),
    transaction: (sliceName, run) =>
      runInTransaction(async () => {
        const entry = await loadSliceEntry(sliceName, createState)
        const store = createStore(sliceName, entry, true)
        const result = await run(store)

        await saveSliceEntry(sliceName, entry)

        return result
      }),
  }
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
      recordedAt: new Date(toStringValue(row.recorded_at)),
    }))
  },
  append: async (eventDrafts: readonly EventDraft[]) => {
    const persistedEvents = []

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

      persistedEvents.push({
        ...eventDraft,
        id,
        order: toNumber(result.rows[0]?.event_order),
        recordedAt,
      })
    }

    return persistedEvents
  },
  transaction: (run) => runInTransaction(() => run(sqliteEventLog)),
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

async function createSliceStore<TState>(
  sliceName: string,
  createState: () => TState,
): Promise<SliceStore<TState>> {
  const entry = await loadSliceEntry(sliceName, createState)
  return createStore(sliceName, entry, false)
}

function createStore<TState>(
  sliceName: string,
  entry: SliceEntry<TState>,
  persistAfterTransaction: boolean,
): SliceStore<TState> {
  return {
    write: entry.state,
    read: entry.state,
    lastAppliedOrder: async () => entry.order,
    setLastAppliedOrder: async (order) => {
      entry.order = order

      if (!persistAfterTransaction) {
        await saveSliceEntry(sliceName, entry)
      }
    },
  }
}

async function loadSliceEntry<TState>(
  sliceName: string,
  createState: () => TState,
): Promise<SliceEntry<TState>> {
  const result = await getDb().execute({
    sql: `
      SELECT state_json, last_applied_order
      FROM specter_slice_states
      WHERE slice_name = ?
    `,
    args: [sliceName],
  })
  const row = result.rows[0]

  if (!row) {
    return { state: createState(), order: 0 }
  }

  return {
    state: deserializeState(toStringValue(row.state_json)) as TState,
    order: toNumber(row.last_applied_order),
  }
}

async function saveSliceEntry<TState>(
  sliceName: string,
  entry: SliceEntry<TState>,
) {
  await getDb().execute({
    sql: `
      INSERT INTO specter_slice_states (
        slice_name,
        state_json,
        last_applied_order
      )
      VALUES (?, ?, ?)
      ON CONFLICT(slice_name) DO UPDATE SET
        state_json = excluded.state_json,
        last_applied_order = excluded.last_applied_order
    `,
    args: [sliceName, serializeState(entry.state), entry.order],
  })
}

function serializeState(value: unknown) {
  return JSON.stringify(value, (_key, nestedValue) => {
    if (nestedValue instanceof Set) {
      return {
        __specterSerializedType: 'Set',
        values: [...nestedValue],
      }
    }

    return nestedValue
  })
}

function deserializeState(value: string) {
  return JSON.parse(value, (_key, nestedValue) => {
    if (
      nestedValue &&
      typeof nestedValue === 'object' &&
      nestedValue.__specterSerializedType === 'Set' &&
      Array.isArray(nestedValue.values)
    ) {
      return new Set(nestedValue.values)
    }

    return nestedValue
  })
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

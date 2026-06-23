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

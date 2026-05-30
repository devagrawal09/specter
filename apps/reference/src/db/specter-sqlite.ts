import { AsyncLocalStorage } from 'node:async_hooks'
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/libsql/sqlite3'
import type {
  EventDraft,
  EventLogAdapter,
  SliceStoreAdapter,
} from '@specter-ts/core'
import type * as schema from './schema'
import { events, sliceCursors } from './specter-schema'

export type SqliteDb = ReturnType<typeof drizzle<typeof schema>>
type SqliteTransaction = Parameters<Parameters<SqliteDb['transaction']>[0]>[0]
type ScopedSqliteDb = SqliteDb | SqliteTransaction

const scopedSqliteDb = new AsyncLocalStorage<ScopedSqliteDb>()

function getDb() {
  const scopedDb = scopedSqliteDb.getStore()

  if (!scopedDb) {
    throw new Error('No SQLite database is bound to the current async context')
  }

  return scopedDb
}

export function runWithSqliteDb<T>(db: SqliteDb, run: () => Promise<T>) {
  return scopedSqliteDb.run(db, run)
}

export const sqliteSliceStore: SliceStoreAdapter<
  ScopedSqliteDb,
  ScopedSqliteDb,
  never
> = {
  get: createSliceStore,
  transaction: (sliceName, run) =>
    getDb().transaction((tx) =>
      scopedSqliteDb.run(tx, () => run(createSliceStore(sliceName))),
    ),
}

function createSliceStore(sliceName: string) {
  return {
    write: getDb(),
    read: getDb(),
    lastAppliedOrder: async () => {
      const rows = await getDb()
        .select()
        .from(sliceCursors)
        .where(eq(sliceCursors.sliceName, sliceName))
        .all()

      return rows[0]?.lastAppliedOrder ?? 0
    },
    setLastAppliedOrder: async (order: number) => {
      await getDb()
        .insert(sliceCursors)
        .values({ sliceName, lastAppliedOrder: order })
        .onConflictDoUpdate({
          target: sliceCursors.sliceName,
          set: {
            lastAppliedOrder: sql`max(${sliceCursors.lastAppliedOrder}, ${order})`,
          },
        })
        .run()
    },
  }
}

export const sqliteEventLog: EventLogAdapter<never> = {
  readAfter: async (order, eventTypes) => {
    if (!eventTypes.length) return []

    const rows = await getDb()
      .select()
      .from(events)
      .where(
        and(gt(events.order, order), inArray(events.type, [...eventTypes])),
      )
      .orderBy(asc(events.order))
      .all()

    return rows.map((event) => ({
      id: event.id,
      type: event.type,
      payload: JSON.parse(event.payload) as unknown,
      order: event.order,
      recordedAt: event.createdAt,
    }))
  },
  append: async (eventDrafts: readonly EventDraft[]) => {
    return Promise.all(eventDrafts.map(async (eventDraft) => {
      const db = getDb()
      const id = crypto.randomUUID()
      const recordedAt = new Date()

      await db
        .insert(events)
        .values({
          id,
          type: eventDraft.type,
          payload: JSON.stringify(eventDraft.payload),
          createdAt: recordedAt,
        })
        .run()

      const rows = await db
        .select({ order: events.order })
        .from(events)
        .where(eq(events.id, id))
        .all()

      return {
        ...eventDraft,
        id,
        order: rows[0]?.order ?? 0,
        recordedAt,
      }
    }))
  },
  transaction: (run) =>
    getDb().transaction((tx) =>
      scopedSqliteDb.run(tx, () => run(sqliteEventLog)),
    ),
}

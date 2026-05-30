import { AsyncLocalStorage } from 'node:async_hooks'
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/better-sqlite3'
import type {
  EventDraft,
  EventLogAdapter,
  SliceStoreAdapter,
} from '@specter-ts/core'
import { events, sliceCursors } from './specter-schema'

const scopedSqliteDb = new AsyncLocalStorage<SqliteDb>()

export type SqliteDb = ReturnType<typeof drizzle>

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

export const sqliteSliceStore: SliceStoreAdapter<SqliteDb, SqliteDb, never> = {
  get: createSliceStore,
  transaction: (sliceName, run) => run(createSliceStore(sliceName)),
}

function createSliceStore(sliceName: string) {
  return {
    write: getDb(),
    read: getDb(),
    lastAppliedOrder: async () => {
      const rows = getDb()
        .select()
        .from(sliceCursors)
        .where(eq(sliceCursors.sliceName, sliceName))
        .all()

      return rows[0]?.lastAppliedOrder ?? 0
    },
    setLastAppliedOrder: async (order: number) => {
      getDb()
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

    const rows = getDb()
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
    return eventDrafts.map((eventDraft) => {
      const db = getDb()
      const id = crypto.randomUUID()
      const recordedAt = new Date()

      db.insert(events)
        .values({
          id,
          type: eventDraft.type,
          payload: JSON.stringify(eventDraft.payload),
          createdAt: recordedAt,
        })
        .run()

      const rows = db
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
    })
  },
  transaction: (run) => run(sqliteEventLog),
}

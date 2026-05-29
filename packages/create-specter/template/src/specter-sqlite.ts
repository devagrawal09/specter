import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type {
  EventDraft,
  EventLogAdapter,
  SliceStoreAdapter,
} from '@specter-ts/core'
import { events, sliceCursors } from '@specter-ts/core/schema'

const sqlitePathEnv = 'SPECTER_SQLITE_PATH'
const defaultSqlitePath = './data/app.db'

let currentSqlitePath = ''
let currentDb: SqliteDb | undefined

type SqliteDb = ReturnType<typeof drizzle>

type EventRow = typeof events.$inferSelect

export function selectSql<TResult>(query: { all: () => TResult }) {
  return query.all()
}

export function runSql(query: { run: () => unknown }) {
  query.run()
}

function getDb() {
  const sqlitePath = process.env[sqlitePathEnv] ?? defaultSqlitePath

  if (currentDb && currentSqlitePath === sqlitePath) {
    return currentDb
  }

  mkdirSync(dirname(sqlitePath), { recursive: true })
  currentSqlitePath = sqlitePath
  currentDb = drizzle(new Database(sqlitePath))

  return currentDb
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

    return rows.map((event: EventRow) => ({
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

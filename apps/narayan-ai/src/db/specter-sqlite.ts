import { AsyncLocalStorage } from 'node:async_hooks'

import { and, asc, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/libsql/sqlite3'
import {
  SpecterIdempotencyConflictError,
  SpecterVersionConflictError,
  type EventDraft,
  type EventLogAdapter,
  type EventLogAppendOptions,
  type EventLogCommit,
  type PersistedEvent,
  type SliceStoreAdapter,
} from '@specter-ts/core'

import type * as schema from './schema'
import { eventCommits, events, sliceCursors } from './specter-schema'

export type SqliteDb = ReturnType<typeof drizzle<typeof schema>>
type SqliteTransaction = Parameters<Parameters<SqliteDb['transaction']>[0]>[0]
export type ScopedSqliteDb = SqliteDb | SqliteTransaction

const scopedEventLogDb = new AsyncLocalStorage<ScopedSqliteDb>()
const scopedSliceDb = new AsyncLocalStorage<ScopedSqliteDb>()
const scopedEventLogSerialization = new AsyncLocalStorage<boolean>()
const scopedSliceSerialization = new AsyncLocalStorage<boolean>()
let eventLogSerializationTail = Promise.resolve()
let sliceSerializationTail = Promise.resolve()

export function hasSqliteDbBinding() {
  return (
    scopedEventLogDb.getStore() !== undefined &&
    scopedSliceDb.getStore() !== undefined
  )
}

function getEventLogDb() {
  const scopedDb = scopedEventLogDb.getStore()

  if (!scopedDb) {
    throw new Error('No Event Log SQLite database is bound to this context')
  }

  return scopedDb
}

function getSliceDb() {
  const scopedDb = scopedSliceDb.getStore()

  if (!scopedDb) {
    throw new Error('No Slice SQLite database is bound to this context')
  }

  return scopedDb
}

export function getBoundSliceDb() {
  return getSliceDb()
}

export function runWithSqliteDb<T>(db: SqliteDb, run: () => Promise<T>) {
  return scopedSliceDb.run(db, () => scopedEventLogDb.run(db, run))
}

export const sqliteSliceStore: SliceStoreAdapter<ScopedSqliteDb> = {
  get: async (sliceName) => createSliceStore(sliceName),
  transaction: (sliceName, run) =>
    serializeSliceOperation(() => run(createSliceStore(sliceName))),
}

async function serializeSliceOperation<T>(run: () => Promise<T>) {
  if (scopedSliceSerialization.getStore()) return run()
  const previous = sliceSerializationTail
  let release = () => {}
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  sliceSerializationTail = previous.then(() => current)
  await previous
  try {
    return await scopedSliceSerialization.run(true, run)
  } finally {
    release()
  }
}

function createSliceStore(sliceName: string) {
  return {
    write: getSliceDb(),
    read: getSliceDb(),
    lastAppliedOrder: async () => {
      const rows = await getSliceDb()
        .select()
        .from(sliceCursors)
        .where(eq(sliceCursors.sliceName, sliceName))
        .all()

      return rows[0]?.lastAppliedOrder ?? 0
    },
    setLastAppliedOrder: async (order: number) => {
      await getSliceDb()
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

export const sqliteEventLog: EventLogAdapter = {
  query: async (order, eventTypes) => {
    if (!eventTypes.length) return []

    const rows = await getEventLogDb()
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
      recordedAt: event.createdAt.toISOString(),
    }))
  },
  currentVersion: async () => currentEventLogVersion(),
  findCommit: async (idempotencyKey) => findEventLogCommit(idempotencyKey),
  append: (
    eventDrafts: readonly EventDraft[],
    options: EventLogAppendOptions = {},
  ) =>
    runEventLogWriteTransaction(async () => {
      const existing = options.idempotencyKey
        ? await findEventLogCommit(options.idempotencyKey)
        : undefined
      if (existing) {
        if (existing.fingerprint !== options.fingerprint) {
          throw new SpecterIdempotencyConflictError(
            options.idempotencyKey ?? '',
          )
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

      const db = getEventLogDb()
      const persistedEvents: PersistedEvent[] = []

      for (const eventDraft of eventDrafts) {
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

        persistedEvents.push({
          ...eventDraft,
          id,
          order: rows[0]?.order ?? 0,
          recordedAt: recordedAt.toISOString(),
        })
      }

      const committedVersion = persistedEvents.at(-1)?.order ?? version
      if (options.idempotencyKey) {
        await db
          .insert(eventCommits)
          .values({
            idempotencyKey: options.idempotencyKey,
            fingerprint: options.fingerprint,
            firstEventOrder: persistedEvents[0]?.order ?? version,
            lastEventOrder: committedVersion,
            committedAt: new Date().toISOString(),
          })
          .run()
      }

      return {
        events: persistedEvents,
        version: committedVersion,
        idempotencyKey: options.idempotencyKey,
        fingerprint: options.fingerprint,
        duplicate: false,
      }
    }),
  transaction: (run) => serializeEventLogOperation(() => run(sqliteEventLog)),
}

async function serializeEventLogOperation<T>(run: () => Promise<T>) {
  if (scopedEventLogSerialization.getStore()) return run()
  const previous = eventLogSerializationTail
  let release = () => {}
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  eventLogSerializationTail = previous.then(() => current)
  await previous
  try {
    return await scopedEventLogSerialization.run(true, run)
  } finally {
    release()
  }
}

async function runEventLogWriteTransaction<T>(run: () => Promise<T>) {
  const db = getEventLogDb()
  if (!('transaction' in db)) return run()
  return db.transaction((tx) => scopedEventLogDb.run(tx, run))
}

async function currentEventLogVersion() {
  const rows = await getEventLogDb()
    .select({ version: sql<number>`coalesce(max(${events.order}), 0)` })
    .from(events)
    .all()
  return Number(rows[0]?.version ?? 0)
}

async function findEventLogCommit(
  idempotencyKey: string,
): Promise<EventLogCommit | undefined> {
  const rows = await getEventLogDb()
    .select()
    .from(eventCommits)
    .where(eq(eventCommits.idempotencyKey, idempotencyKey))
    .all()
  const receipt = rows[0]
  if (!receipt) return undefined

  const committedEvents = await getEventLogDb()
    .select()
    .from(events)
    .where(
      and(
        gte(events.order, receipt.firstEventOrder),
        lte(events.order, receipt.lastEventOrder),
      ),
    )
    .orderBy(asc(events.order))
    .all()

  return {
    events: committedEvents.map((event) => ({
      id: event.id,
      type: event.type,
      payload: JSON.parse(event.payload) as unknown,
      order: event.order,
      recordedAt: event.createdAt.toISOString(),
    })),
    version: receipt.lastEventOrder,
    idempotencyKey,
    fingerprint: receipt.fingerprint ?? undefined,
  }
}

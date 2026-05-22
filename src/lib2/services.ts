import { Context, type Effect } from 'effect'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'

import type { Event, PersistedEvent } from './event'

export type RegistryRuntime = {
  sqliteFilename: string
}

export type EventLogPort = {
  readAfter: (
    order: number,
    eventTypes: readonly string[],
  ) => Effect.Effect<PersistedEvent[], unknown>
  append: (events: readonly Event[]) => Effect.Effect<PersistedEvent[], unknown>
}

export class EventLogService extends Context.Tag('lib2/EventLog')<
  EventLogService,
  EventLogPort
>() {}

export type SliceRepo = {
  get: (sliceName: string) => SliceStore
}

export type SliceStore = {
  state: SqliteRemoteDatabase
  lastAppliedOrder: Effect.Effect<number, unknown>
  setLastAppliedOrder: (order: number) => Effect.Effect<void, unknown>
}

export class SliceStores extends Context.Tag('lib2/SliceStores')<
  SliceStores,
  SliceRepo
>() {}

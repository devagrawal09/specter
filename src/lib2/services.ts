import { Context, type Effect } from 'effect'

import type { Event, PersistedEvent } from './event'
import type { JsonSliceStorage } from './json-storage'

export type RegistryRuntime = {
  sqliteFilename: string
  jsonStorage: JsonSliceStorage
}

export class JsonTx extends Context.Tag('lib2/JsonTx')<
  JsonTx,
  JsonSliceStorage
>() {}

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

export type SliceStateStore = {
  create: (sliceName: string, json: boolean) => SliceState
}

export type SliceState = {
  input: unknown
  lastAppliedOrder: Effect.Effect<number, unknown>
  setLastAppliedOrder: (order: number) => Effect.Effect<void, unknown>
  commit: Effect.Effect<void, unknown>
}

export class SliceStates extends Context.Tag('lib2/SliceStates')<
  SliceStates,
  SliceStateStore
>() {}

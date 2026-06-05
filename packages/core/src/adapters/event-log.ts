import type { EventDraft, PersistedEvent } from '../definition/events'

export type EventLogAdapter = {
  query: (
    order: number,
    eventTypes: readonly string[],
  ) => Promise<PersistedEvent[]>
  append: (events: readonly EventDraft[]) => Promise<PersistedEvent[]>
  transaction: <T>(run: (eventLog: EventLogAdapter) => Promise<T>) => Promise<T>
}

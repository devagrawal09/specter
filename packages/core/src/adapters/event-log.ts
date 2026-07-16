import type { EventDraft, PersistedEvent } from '../definition/events'

export type EventLogCommit = {
  readonly events: readonly PersistedEvent[]
  readonly version: number
  readonly idempotencyKey?: string
  readonly fingerprint?: string
}

/**
 * The result of one atomic append attempt. A duplicate result is the durable
 * receipt for an earlier append discovered while holding the append lock; no
 * new Events were written by this attempt.
 */
export type EventLogAppendResult = EventLogCommit & {
  readonly duplicate: boolean
}

export type EventLogAppendOptions = {
  readonly expectedVersion?: number
  readonly idempotencyKey?: string
  readonly fingerprint?: string
}

export type EventLogTransaction = {
  query: (
    afterOrder: number,
    eventTypes: readonly string[],
  ) => Promise<PersistedEvent[]>
  currentVersion: () => Promise<number>
  findCommit: (idempotencyKey: string) => Promise<EventLogCommit | undefined>
  append: (
    events: readonly EventDraft[],
    options?: EventLogAppendOptions,
  ) => Promise<EventLogAppendResult>
}

export type EventLogAdapter = EventLogTransaction & {
  /**
   * Runs one callback in a serialized Event Log transaction. Command
   * catch-up, decision, and append all execute inside this boundary.
   */
  transaction: <T>(
    run: (eventLog: EventLogTransaction) => Promise<T>,
  ) => Promise<T>
}

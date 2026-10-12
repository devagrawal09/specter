import { Context, type Effect } from 'effect'

import type { EventDraft, EventKey, PersistedEvent } from '../definition/events'

export type EventLogCommit = {
  readonly events: readonly PersistedEvent[]
  readonly version: number
  readonly committedAt: string
  readonly idempotencyKey?: string
  readonly fingerprint?: string
}

export type EventLogAppendResult = EventLogCommit & {
  readonly duplicate: boolean
}

/**
 * An Event to append, with the named keys core derived from its payload. The
 * Event Log stores the keys with the Event and returns them with it: its
 * scoped compare-and-swap and keyed reads use them, and it never derives keys
 * itself.
 */
export type EventLogDraft = EventDraft & {
  /** One value per key name the Event carries; empty for an unkeyed Event. */
  readonly keys: Readonly<Record<string, string>>
}

/**
 * What a decision read, for a compare-and-swap scoped to it: the Events of
 * `eventTypes` up to `afterOrder`, narrowed to those carrying one of `keys`
 * when present. An append under it is stale when such an Event was appended
 * after `afterOrder`.
 */
export type EventLogAppendCondition = {
  readonly afterOrder: number
  readonly eventTypes: readonly string[]
  /**
   * Values by key name. An Event matches when it carries one of the values
   * listed under one of its key names; with no value listed, none matches.
   * Every Event of `eventTypes` matches when omitted.
   */
  readonly keys?: Readonly<Record<string, readonly string[]>>
}

/**
 * What an Event Log adapter supports beyond appending and reading the log.
 * The runtime refuses to start on an adapter that lacks a capability the app
 * uses, and an adapter must refuse an operation it does not support rather
 * than ignore part of it.
 */
export type EventLogCapabilities = {
  /**
   * `append` checks `expectedUnchanged`, keys included, under its append
   * lock. Every Command without a caller `expectedVersion` uses it. Without
   * it, an append carrying `expectedUnchanged` fails.
   */
  readonly scopedAppend: boolean
  /**
   * `readKey` reads the Events carrying a key. Without it, `readKey` fails.
   */
  readonly keyedRead: boolean
}

/** A page of a keyed read: the Events after `afterOrder`, at most `limit`. */
export type EventLogKeyPage = {
  /** Defaults to 0, the start of the log. */
  readonly afterOrder?: number
  /** Every remaining Event when omitted. */
  readonly limit?: number
}

export type EventLogAppendOptions = {
  /** The append is stale unless the log is at exactly this version. */
  readonly expectedVersion?: number
  /**
   * The append is stale when an Event of `eventTypes` with an order above
   * `afterOrder`, carrying one of `keys` when given, is already in the log.
   */
  readonly expectedUnchanged?: EventLogAppendCondition
  readonly idempotencyKey?: string
  readonly fingerprint?: string
}

export class EventLogFailure extends Error {
  readonly _tag = 'EventLogFailure' as const

  constructor(
    readonly operation:
      | 'query'
      | 'commitsAfter'
      | 'currentVersion'
      | 'findCommit'
      | 'readKey'
      | 'append',
    readonly cause: unknown,
  ) {
    super(`Event Log ${operation} failed.`, { cause })
    this.name = 'EventLogFailure'
  }
}

/** Effect-native Event Log capability. Implementations own serialization. */
export type EventLogService = {
  /** What this Event Log supports; see `EventLogCapabilities`. */
  readonly capabilities: EventLogCapabilities
  readonly query: (
    afterOrder: number,
    eventTypes: readonly string[],
  ) => Effect.Effect<readonly PersistedEvent[], EventLogFailure>
  readonly currentVersion: Effect.Effect<number, EventLogFailure>
  readonly commitsAfter: (
    afterVersion: number,
  ) => Effect.Effect<readonly EventLogCommit[], EventLogFailure>
  /**
   * The Events carrying one key, such as one aggregate's: those whose stored
   * key `key.name` is `key.value`, with an order above `page.afterOrder`, in
   * ascending order, at most `page.limit` of them.
   */
  readonly readKey: (
    key: EventKey,
    page?: EventLogKeyPage,
  ) => Effect.Effect<readonly PersistedEvent[], EventLogFailure>
  /** Returns the stored commit for a key, including its stored fingerprint. */
  readonly findCommit: (
    idempotencyKey: string,
  ) => Effect.Effect<EventLogCommit | undefined, EventLogFailure>
  /**
   * Atomically appends one commit, storing each Event's keys with it. When
   * idempotencyKey already exists, returns the stored commit (with its
   * original fingerprint) as `duplicate: true` and appends nothing, whatever
   * fingerprint was passed. The runtime decides whether a fingerprint
   * mismatch is a conflict. Otherwise a stale `expectedVersion` or
   * `expectedUnchanged` fails with an `EventLogFailure('append')` whose cause
   * is a SpecterVersionConflictError, checked in the store under the same
   * lock as the write.
   */
  readonly append: (
    events: readonly EventLogDraft[],
    options?: EventLogAppendOptions,
  ) => Effect.Effect<EventLogAppendResult, EventLogFailure>
}

export class EventLog extends Context.Service<EventLog, EventLogService>()(
  '@specter-ts/core/EventLog',
) {}

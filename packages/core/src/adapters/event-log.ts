import { Context, type Effect } from 'effect'

import type { EventDraft, PersistedEvent } from '../definition/events'

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
 * What a decision read, for a compare-and-swap scoped to it: the Events of
 * `eventTypes` up to `afterOrder`, narrowed by `matches` when present. An
 * append under it is stale when a matching Event was appended after
 * `afterOrder`.
 */
export type EventLogAppendCondition = {
  readonly afterOrder: number
  readonly eventTypes: readonly string[]
  /** Every Event of `eventTypes` matches when omitted. */
  readonly matches?: (event: PersistedEvent) => boolean
}

export type EventLogAppendOptions = {
  /** The append is stale unless the log is at exactly this version. */
  readonly expectedVersion?: number
  /**
   * The append is stale when an Event of `eventTypes` with an order above
   * `afterOrder`, and matched by `matches` when given, is already in the log.
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
      | 'append',
    readonly cause: unknown,
  ) {
    super(`Event Log ${operation} failed.`, { cause })
    this.name = 'EventLogFailure'
  }
}

/** Effect-native Event Log capability. Implementations own serialization. */
export type EventLogService = {
  readonly query: (
    afterOrder: number,
    eventTypes: readonly string[],
  ) => Effect.Effect<readonly PersistedEvent[], EventLogFailure>
  readonly currentVersion: Effect.Effect<number, EventLogFailure>
  readonly commitsAfter: (
    afterVersion: number,
  ) => Effect.Effect<readonly EventLogCommit[], EventLogFailure>
  /** Returns the stored commit for a key, including its stored fingerprint. */
  readonly findCommit: (
    idempotencyKey: string,
  ) => Effect.Effect<EventLogCommit | undefined, EventLogFailure>
  /**
   * Atomically appends one commit. When idempotencyKey already exists, returns
   * the stored commit (with its original fingerprint) as `duplicate: true` and
   * appends nothing, whatever fingerprint was passed. The runtime decides
   * whether a fingerprint mismatch is a conflict. Otherwise a stale
   * `expectedVersion` or `expectedUnchanged` fails with an
   * `EventLogFailure('append')` whose cause is a SpecterVersionConflictError,
   * checked under the same lock as the write.
   */
  readonly append: (
    events: readonly EventDraft[],
    options?: EventLogAppendOptions,
  ) => Effect.Effect<EventLogAppendResult, EventLogFailure>
}

export class EventLog extends Context.Service<EventLog, EventLogService>()(
  '@specter-ts/core/EventLog',
) {}

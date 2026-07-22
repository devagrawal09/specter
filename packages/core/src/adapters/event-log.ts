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

export type EventLogAppendOptions = {
  readonly expectedVersion?: number
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
  readonly findCommit: (
    idempotencyKey: string,
  ) => Effect.Effect<EventLogCommit | undefined, EventLogFailure>
  readonly append: (
    events: readonly EventDraft[],
    options?: EventLogAppendOptions,
  ) => Effect.Effect<EventLogAppendResult, EventLogFailure>
}

export class EventLog extends Context.Service<EventLog, EventLogService>()(
  '@specter-ts/core/EventLog',
) {}

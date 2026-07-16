import type { PersistedEvent } from '@specter-ts/core'

export type ReactionRunOutcome = 'started' | 'completed' | 'failed'
export type ProjectionActivity = 'catch-up' | 'replay'
export type ProjectionOutcome = 'started' | 'completed' | 'failed'

export type EventsPersistedSignal = {
  readonly type: 'events.persisted'
  readonly events: readonly PersistedEvent[]
  readonly version: number
  readonly idempotencyKey?: string
}

export type SliceCursorSignal = {
  readonly type: 'slice.cursor'
  readonly sliceName: string
  readonly lastAppliedOrder: number
  readonly eventLogVersion: number
  readonly lag: number
}

export type SubscriptionInvalidatedSignal = {
  readonly type: 'subscription.invalidated'
  readonly queryType: string
  readonly subscriberId?: string
  readonly reason?: string
}

export type ReactionRunSignal = {
  readonly type: 'reaction.run'
  readonly reactionName?: string
  readonly outcome: ReactionRunOutcome
  readonly durationMs?: number
  readonly error?: string
}

export type OutboxAttemptSignal = {
  readonly type: 'outbox.attempt'
  readonly jobId: string
  readonly attemptId: string
  readonly attemptNumber: number
  readonly requestedAt: Date
  readonly outcome: 'started' | 'completed' | 'retrying' | 'dead-lettered'
  readonly availableAt?: Date
  readonly error?: string
}

export type ProjectionActivitySignal = {
  readonly type: 'projection.activity'
  readonly sliceName: string
  readonly activity: ProjectionActivity
  readonly outcome: ProjectionOutcome
  readonly fromOrder: number
  readonly toOrder?: number
  readonly eventCount?: number
  readonly durationMs?: number
  readonly error?: string
}

export type CommandCommittedSignal = {
  readonly type: 'command.committed'
  readonly commandType: string
  readonly version: number
  readonly eventCount: number
  readonly duplicate: boolean
}

export type SpecterOperationalSignal =
  | EventsPersistedSignal
  | SliceCursorSignal
  | SubscriptionInvalidatedSignal
  | ReactionRunSignal
  | OutboxAttemptSignal
  | ProjectionActivitySignal
  | CommandCommittedSignal

export type RecordedSpecterOperationalSignal = SpecterOperationalSignal & {
  readonly sequence: number
  readonly observedAt: Date
}

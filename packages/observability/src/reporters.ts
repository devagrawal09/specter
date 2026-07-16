import type { ReactionOutboxTransitionListener } from '@specter-ts/reaction-outbox'

import type { SpecterObservabilitySink } from './recorder'

const errorSummary = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause)

export function reportSliceCursor(
  sink: SpecterObservabilitySink,
  input: {
    readonly sliceName: string
    readonly lastAppliedOrder: number
    readonly eventLogVersion: number
  },
) {
  return sink.record({
    type: 'slice.cursor',
    ...input,
    lag: Math.max(0, input.eventLogVersion - input.lastAppliedOrder),
  })
}

export function reportSubscriptionInvalidated(
  sink: SpecterObservabilitySink,
  input: {
    readonly queryType: string
    readonly subscriberId?: string
    readonly reason?: string
  },
) {
  return sink.record({ type: 'subscription.invalidated', ...input })
}

export function reportReactionRun(
  sink: SpecterObservabilitySink,
  input: {
    readonly reactionName?: string
    readonly outcome: 'started' | 'completed' | 'failed'
    readonly durationMs?: number
    readonly cause?: unknown
  },
) {
  return sink.record({
    type: 'reaction.run',
    reactionName: input.reactionName,
    outcome: input.outcome,
    durationMs: input.durationMs,
    error: input.cause === undefined ? undefined : errorSummary(input.cause),
  })
}

export function reportProjectionActivity(
  sink: SpecterObservabilitySink,
  input: {
    readonly sliceName: string
    readonly activity: 'catch-up' | 'replay'
    readonly outcome: 'started' | 'completed' | 'failed'
    readonly fromOrder: number
    readonly toOrder?: number
    readonly eventCount?: number
    readonly durationMs?: number
    readonly cause?: unknown
  },
) {
  return sink.record({
    type: 'projection.activity',
    sliceName: input.sliceName,
    activity: input.activity,
    outcome: input.outcome,
    fromOrder: input.fromOrder,
    toOrder: input.toOrder,
    eventCount: input.eventCount,
    durationMs: input.durationMs,
    error: input.cause === undefined ? undefined : errorSummary(input.cause),
  })
}

export function createOutboxObservabilityListener<TPayload>(
  sink: SpecterObservabilitySink,
): ReactionOutboxTransitionListener<TPayload> {
  return async (transition) => {
    switch (transition.type) {
      case 'attempt-started':
        await sink.record({
          type: 'outbox.attempt',
          jobId: transition.claim.id,
          attemptId: transition.claim.activeAttemptId,
          attemptNumber: transition.claim.attemptCount,
          requestedAt: transition.claim.requestedAt,
          outcome: 'started',
        })
        break
      case 'attempt-completed':
        await sink.record({
          type: 'outbox.attempt',
          jobId: transition.claim.id,
          attemptId: transition.claim.activeAttemptId,
          attemptNumber: transition.claim.attemptCount,
          requestedAt: transition.claim.requestedAt,
          outcome: 'completed',
        })
        break
      case 'attempt-retrying':
        await sink.record({
          type: 'outbox.attempt',
          jobId: transition.claim.id,
          attemptId: transition.claim.activeAttemptId,
          attemptNumber: transition.claim.attemptCount,
          requestedAt: transition.claim.requestedAt,
          outcome: 'retrying',
          availableAt: transition.availableAt,
          error: transition.error,
        })
        break
      case 'dead-lettered':
        await sink.record({
          type: 'outbox.attempt',
          jobId: transition.claim.id,
          attemptId: transition.claim.activeAttemptId,
          attemptNumber: transition.claim.attemptCount,
          requestedAt: transition.claim.requestedAt,
          outcome: 'dead-lettered',
          error: transition.error,
        })
        break
      case 'enqueued':
      case 'dead-letter-retried':
        break
    }
  }
}

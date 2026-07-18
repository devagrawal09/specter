import type {
  SpecterEventReference,
  SpecterObservation,
  SpecterObserver,
} from '@specter-ts/core'
import type {
  EventReference,
  JsonValue,
  ObservationKind,
  RuntimeObservation,
  RuntimeSource,
  StructuredError,
} from '@specter-ts/protocol'
import type { ReactionOutboxTransitionListener } from '@specter-ts/reaction-outbox'

import type { RuntimeObservationProducer } from './producer'

export type RuntimeObservationAdapterOptions = {
  readonly producer: Pick<RuntimeObservationProducer, 'record'>
  readonly source: RuntimeSource
  readonly idFactory?: () => string
  readonly now?: () => Date
}

export type RuntimeObservationEmitter = {
  readonly observe: SpecterObserver
  readonly outbox: ReactionOutboxTransitionListener
  emit(
    input: Omit<
      RuntimeObservation,
      'observationId' | 'sequence' | 'observedAt' | 'source'
    >,
  ): void
}

export function createRuntimeObservationEmitter(
  options: RuntimeObservationAdapterOptions,
): RuntimeObservationEmitter {
  const idFactory = options.idFactory ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date())
  let sequence = 0

  function emit(
    input: Omit<
      RuntimeObservation,
      'observationId' | 'sequence' | 'observedAt' | 'source'
    >,
  ) {
    try {
      options.producer.record({
        ...input,
        observationId: idFactory(),
        sequence: ++sequence,
        observedAt: now().toISOString(),
        source: options.source,
      })
    } catch {
      // Telemetry must never delay or change application execution.
    }
  }

  const observe: SpecterObserver = (observation) => {
    try {
      options.producer.record(
        fromSpecterObservation(observation, options.source, ++sequence),
      )
    } catch {
      // Telemetry must never delay or change application execution.
    }
  }

  const outbox: ReactionOutboxTransitionListener = (transition) => {
    switch (transition.type) {
      case 'enqueued':
        if (!transition.created) return
        emit({
          kind: 'outbox.enqueued',
          operationId: transition.job.id,
          deliveryId: transition.job.id,
          attributes: {
            requestedAt: transition.job.requestedAt.toISOString(),
          },
        })
        return
      case 'attempt-started':
      case 'attempt-completed':
        emit({
          kind: 'outbox.attempted',
          operationId: transition.claim.activeAttemptId,
          deliveryId: transition.claim.id,
          outcome:
            transition.type === 'attempt-completed' ? 'succeeded' : undefined,
          attributes: {
            attemptNumber: transition.claim.attemptCount,
            phase:
              transition.type === 'attempt-started' ? 'started' : 'completed',
          },
        })
        return
      case 'attempt-retrying':
        emit({
          kind: 'outbox.retry-scheduled',
          operationId: transition.claim.activeAttemptId,
          deliveryId: transition.claim.id,
          outcome: 'failed',
          error: {
            code: 'SPECTER_OUTBOX_ATTEMPT_FAILED',
            message: 'Outbox attempt failed.',
            retryable: true,
          },
          attributes: {
            attemptNumber: transition.claim.attemptCount,
            availableAt: transition.availableAt.toISOString(),
          },
        })
        return
      case 'dead-lettered':
        emit({
          kind: 'outbox.dead-lettered',
          operationId: transition.claim.activeAttemptId,
          deliveryId: transition.claim.id,
          outcome: 'failed',
          error: {
            code: 'SPECTER_OUTBOX_DEAD_LETTERED',
            message: 'Outbox delivery was dead-lettered.',
          },
          attributes: { attemptNumber: transition.claim.attemptCount },
        })
        return
      case 'dead-letter-retried':
        emit({
          kind: 'outbox.retry-scheduled',
          operationId: transition.jobId,
          deliveryId: transition.jobId,
          attributes: {
            availableAt: transition.availableAt.toISOString(),
            phase: 'dead-letter-retried',
          },
        })
    }
  }

  return { emit, observe, outbox }
}

export function createSpecterProtocolObserver(
  options: RuntimeObservationAdapterOptions,
): SpecterObserver {
  return createRuntimeObservationEmitter(options).observe
}

function fromSpecterObservation(
  observation: SpecterObservation,
  source: RuntimeSource,
  sequence: number,
): RuntimeObservation {
  const base = {
    observationId: observation.observationId,
    sequence,
    observedAt: observation.observedAt,
    source,
    operationId: observation.operationId,
    ...(observation.correlationId
      ? { correlationId: observation.correlationId }
      : {}),
    ...(observation.parentOperationIds.length
      ? { parentOperationIds: observation.parentOperationIds }
      : {}),
    ...causes(observation.causedByEvents),
  }

  switch (observation.type) {
    case 'command-started':
      return {
        ...base,
        kind: 'command.started',
        commandType: observation.commandType,
      }
    case 'command-completed':
      return {
        ...base,
        kind: 'command.completed',
        outcome: 'succeeded',
        commandType: observation.commandType,
        events: protocolEvents(observation.events),
        attributes: {
          duplicate: observation.duplicate,
          durationMs: observation.durationMs,
          version: observation.version,
        },
      }
    case 'command-rejected':
    case 'command-failed':
      return {
        ...base,
        kind:
          observation.type === 'command-rejected'
            ? 'command.rejected'
            : 'command.failed',
        outcome:
          observation.type === 'command-rejected' ? 'rejected' : 'failed',
        commandType: observation.commandType,
        error: publicError(observation.cause),
        attributes: { durationMs: observation.durationMs },
      }
    case 'event-persisted':
      return {
        ...base,
        kind: 'events.persisted',
        outcome: 'succeeded',
        events: protocolEvents([observation.event]),
      }
    case 'query-started':
      return {
        ...base,
        kind: 'query.started',
        queryType: observation.queryName,
        attributes: { subscription: observation.subscription },
      }
    case 'query-completed':
      return {
        ...base,
        kind: 'query.completed',
        outcome: 'succeeded',
        queryType: observation.queryName,
        attributes: {
          subscription: observation.subscription,
          durationMs: observation.durationMs,
        },
      }
    case 'query-rejected':
    case 'query-failed':
      return {
        ...base,
        kind:
          observation.type === 'query-rejected'
            ? 'query.rejected'
            : 'query.failed',
        outcome: observation.type === 'query-rejected' ? 'rejected' : 'failed',
        queryType: observation.queryName,
        error: publicError(observation.cause),
        attributes: {
          subscription: observation.subscription,
          durationMs: observation.durationMs,
        },
      }
    case 'slice-caught-up':
      return {
        ...base,
        kind: 'slice.catch-up.completed',
        outcome: 'succeeded',
        slice: observation.sliceName,
        cursor: observation.toOrder,
        attributes: {
          sliceKind: observation.sliceKind,
          fromOrder: observation.fromOrder,
          eventCount: observation.eventCount,
        },
      }
    case 'subscriptions-invalidated':
      return {
        ...base,
        kind: 'subscription.invalidated',
        queryType: observation.queryName,
        attributes: {
          subscriberCount: observation.subscriberCount,
          changedEventTypes: observation.changedEventTypes,
        },
      }
    case 'reaction-pass-started':
      return {
        ...base,
        kind: 'reaction.pass.started',
        reactionPassId: observation.passId,
        deliveryId: observation.attemptId,
        attributes: { attemptNumber: observation.attemptNumber },
      }
    case 'reaction-pass-completed':
    case 'reaction-pass-failed':
      return {
        ...base,
        kind:
          observation.type === 'reaction-pass-completed'
            ? 'reaction.pass.completed'
            : 'reaction.pass.failed',
        outcome:
          observation.type === 'reaction-pass-completed'
            ? 'succeeded'
            : 'failed',
        reactionPassId: observation.passId,
        deliveryId: observation.attemptId,
        ...(observation.type === 'reaction-pass-failed'
          ? { error: publicError(observation.cause) }
          : {}),
        attributes: {
          attemptNumber: observation.attemptNumber,
          failureCount: observation.failureCount,
          durationMs: observation.durationMs,
          eventRanges: observation.eventRanges,
        },
      }
    case 'reaction-run-started':
    case 'reaction-run-completed':
    case 'reaction-run-failed': {
      const kind: ObservationKind =
        observation.type === 'reaction-run-started'
          ? 'reaction.run.started'
          : observation.type === 'reaction-run-completed'
            ? 'reaction.run.completed'
            : 'reaction.run.failed'
      return {
        ...base,
        kind,
        reaction: observation.reactionName,
        reactionPassId: observation.passId,
        deliveryId: observation.attemptId,
        ...(observation.type === 'reaction-run-completed'
          ? { outcome: 'succeeded' as const }
          : {}),
        ...(observation.type === 'reaction-run-failed'
          ? {
              outcome: 'failed' as const,
              error: publicError(observation.cause),
            }
          : {}),
        ...(observation.eventRange
          ? {
              triggeringEventOrder: {
                from: observation.eventRange.fromOrder,
                to: observation.eventRange.toOrder,
              },
            }
          : {}),
        attributes: {
          runId: observation.runId,
          ...(observation.type === 'reaction-run-started'
            ? {}
            : { durationMs: observation.durationMs }),
        },
      }
    }
  }
}

function protocolEvents(
  events: readonly SpecterEventReference[],
): readonly EventReference[] {
  return events.flatMap((event) =>
    event.commitVersion === undefined
      ? []
      : [
          {
            eventId: event.id,
            type: event.type,
            order: event.order,
            recordedAt: event.recordedAt,
            commitVersion: event.commitVersion,
          },
        ],
  )
}

function causes(events: readonly SpecterEventReference[]) {
  if (!events.length) return {}
  const orders = events.map((event) => event.order)
  return {
    triggeringEventIds: events.map((event) => event.id),
    triggeringEventOrder: {
      from: Math.min(...orders),
      to: Math.max(...orders),
    },
  }
}

function publicError(cause: unknown): StructuredError {
  if (cause instanceof Error) {
    if ('code' in cause && typeof cause.code === 'string') {
      return { code: cause.code, message: cause.message || cause.name }
    }
  }
  return {
    code: 'SPECTER_RUNTIME_FAILURE',
    message: 'Runtime operation failed.',
  }
}

const _jsonValueCheck: JsonValue = null
void _jsonValueCheck

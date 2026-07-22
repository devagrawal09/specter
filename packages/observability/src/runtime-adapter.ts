import {
  SpecterObserver,
  type SpecterEventReference,
  type SpecterObservation,
  type SpecterObserverService,
} from '@specter-ts/core'
import type {
  EventReference,
  JsonValue,
  ObservationKind,
  RuntimeObservation,
  RuntimeSource,
  StructuredError,
} from '@specter-ts/protocol'
import { structuredProtocolError } from '@specter-ts/protocol'
import type { ReactionOutboxTransitionListener } from '@specter-ts/reaction-outbox'
import { Effect, Layer } from 'effect'

import type { RuntimeObservationProducer } from './producer'

export type RuntimeObservationAdapterOptions = {
  readonly producer: Pick<RuntimeObservationProducer, 'record'>
  readonly source: RuntimeSource
  readonly idFactory?: () => string
  readonly now?: () => Date
  readonly specificationDigests?: Readonly<Record<string, `sha256:${string}`>>
}

export type RuntimeObservationEmitter = {
  readonly observer: SpecterObserverService
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
  const lastOutboxOperation = new Map<string, string>()
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

  const observer: SpecterObserverService = {
    observe: (observation) =>
      Effect.sync(() => {
        try {
          const protocol = fromSpecterObservation(
            observation,
            options.source,
            ++sequence,
          )
          const slice =
            protocol.slice ??
            protocol.commandType ??
            protocol.queryType ??
            protocol.reaction
          const specificationDigest = slice
            ? options.specificationDigests?.[slice]
            : undefined
          options.producer.record({
            ...protocol,
            ...(slice ? { slice } : {}),
            ...(specificationDigest ? { specificationDigest } : {}),
          })
        } catch {
          // Telemetry must never delay or change application execution.
        }
      }),
  }

  const outbox: ReactionOutboxTransitionListener = (transition) => {
    switch (transition.type) {
      case 'enqueued': {
        if (!transition.created) return
        const operationId = outboxOperationId(transition.job.id, 'enqueued')
        emit({
          kind: 'outbox.enqueued',
          operationId,
          deliveryId: transition.job.id,
          attributes: {
            requestedAt: transition.job.requestedAt.toISOString(),
          },
        })
        lastOutboxOperation.set(transition.job.id, operationId)
        return
      }
      case 'attempt-started':
      case 'attempt-completed': {
        const phase =
          transition.type === 'attempt-started' ? 'started' : 'completed'
        const operationId = outboxOperationId(
          transition.claim.activeAttemptId,
          phase,
        )
        emit({
          kind: 'outbox.attempted',
          operationId,
          deliveryId: transition.claim.id,
          parentOperationIds: outboxParents(
            transition.claim.id,
            lastOutboxOperation,
          ),
          outcome:
            transition.type === 'attempt-completed' ? 'succeeded' : undefined,
          attributes: {
            attemptNumber: transition.claim.attemptCount,
            phase,
          },
        })
        lastOutboxOperation.set(transition.claim.id, operationId)
        return
      }
      case 'attempt-retrying': {
        const operationId = outboxOperationId(
          transition.claim.activeAttemptId,
          'retry-scheduled',
        )
        emit({
          kind: 'outbox.retry-scheduled',
          operationId,
          deliveryId: transition.claim.id,
          parentOperationIds: outboxParents(
            transition.claim.id,
            lastOutboxOperation,
          ),
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
        lastOutboxOperation.set(transition.claim.id, operationId)
        return
      }
      case 'dead-lettered': {
        const operationId = outboxOperationId(
          transition.claim.activeAttemptId,
          'dead-lettered',
        )
        emit({
          kind: 'outbox.dead-lettered',
          operationId,
          deliveryId: transition.claim.id,
          parentOperationIds: outboxParents(
            transition.claim.id,
            lastOutboxOperation,
          ),
          outcome: 'failed',
          error: {
            code: 'SPECTER_OUTBOX_DEAD_LETTERED',
            message: 'Outbox delivery was dead-lettered.',
          },
          attributes: { attemptNumber: transition.claim.attemptCount },
        })
        lastOutboxOperation.set(transition.claim.id, operationId)
        return
      }
      case 'dead-letter-retried': {
        const operationId = outboxOperationId(
          transition.jobId,
          `dead-letter-retried:${transition.availableAt.toISOString()}`,
        )
        emit({
          kind: 'outbox.retry-scheduled',
          operationId,
          deliveryId: transition.jobId,
          parentOperationIds: outboxParents(
            transition.jobId,
            lastOutboxOperation,
          ),
          attributes: {
            availableAt: transition.availableAt.toISOString(),
            phase: 'dead-letter-retried',
          },
        })
        lastOutboxOperation.set(transition.jobId, operationId)
      }
    }
  }

  return { emit, observer, outbox }
}

export function createSpecterProtocolObserver(
  options: RuntimeObservationAdapterOptions,
): SpecterObserverService {
  return createRuntimeObservationEmitter(options).observer
}

export function createSpecterProtocolObserverLayer(
  options: RuntimeObservationAdapterOptions,
) {
  return Layer.succeed(SpecterObserver, createSpecterProtocolObserver(options))
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
    ...causalityMetadata(observation),
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
        deliveryId: observation.deliveryId,
        ...(observation.type === 'reaction-run-completed'
          ? { outcome: 'succeeded' as const }
          : {}),
        ...(observation.type === 'reaction-run-failed'
          ? {
              outcome: 'failed' as const,
              error: publicError(observation.cause),
            }
          : {}),
        attributes: {
          commitVersion: observation.commitVersion,
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

function causalityMetadata(observation: SpecterObservation) {
  const eventIds = [
    ...(observation.triggeringEventIds ?? []),
    ...observation.causedByEvents.map((event) => event.id),
  ]
  const orders = observation.causedByEvents.map((event) => event.order)
  const triggeringEventOrder =
    observation.triggeringEventOrder ??
    (orders.length
      ? { from: Math.min(...orders), to: Math.max(...orders) }
      : undefined)
  return {
    ...(eventIds.length ? { triggeringEventIds: [...new Set(eventIds)] } : {}),
    ...(triggeringEventOrder ? { triggeringEventOrder } : {}),
  }
}

function outboxOperationId(deliveryOrAttemptId: string, phase: string) {
  return `${deliveryOrAttemptId}:${phase}`
}

function outboxParents(
  deliveryId: string,
  lastOutboxOperation: ReadonlyMap<string, string>,
) {
  return [
    lastOutboxOperation.get(deliveryId) ??
      outboxOperationId(deliveryId, 'enqueued'),
  ]
}

function publicError(cause: unknown): StructuredError {
  return structuredProtocolError(cause)
}

const _jsonValueCheck: JsonValue = null
void _jsonValueCheck

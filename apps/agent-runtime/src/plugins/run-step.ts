import {
  type ReactionPlugin,
  SpecterCommandRejectedError,
} from '@specter-ts/core'
import type { SessionID } from '@ocpp/schema/session-id'
import { Effect, PubSub } from 'effect'

import { nextDeliverable } from '../features/session/next-deliverable-query/impl.ts'
import type { RunStepRequest } from '../features/session/run-step-reaction/impl.ts'
import { stepStatus } from '../features/session/step-status-query/impl.ts'
import { DeltaChannel } from './delta-channel.ts'
import { ScriptedModel } from './scripted-model.ts'

// A rejected Command means the world moved on (execution interrupted, step
// already recorded by a duplicate request): stop quietly. Anything else fails
// the job so the outbox retries it.
const unlessRejected = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map(() => true),
    Effect.catch((error) =>
      error instanceof SpecterCommandRejectedError
        ? Effect.succeed(false)
        : Effect.fail(error),
    ),
  )

// Orphan reconciliation (session.md: Execution Is Process-Local): fail the
// step the dead process left in flight. One Command records the failure and
// its outcome atomically: a scheduled retry, or the execution failing when the
// budget is spent. The retry's state-derived request starts the next physical
// attempt of the same step id; this job does not run the model.
const reconcileOrphan = (
  { command }: Pick<Parameters<ReactionPlugin<RunStepRequest>>[0], 'command'>,
  orphan: {
    sessionID: SessionID
    assistantMessageID: string
    deliveryId: string
  },
) =>
  Effect.gen(function* () {
    const { sessionID, assistantMessageID, deliveryId } = orphan
    yield* unlessRejected(
      command(
        {
          type: 'recordStepFailed',
          payload: {
            sessionID,
            assistantMessageID,
            error: {
              type: 'orphaned',
              message: 'Step was in flight when its process stopped',
            },
            retryable: true,
            at: Date.now(),
          },
        },
        { idempotencyKey: `${deliveryId}:orphaned` },
      ),
    )
  })

// One job = one safe-step boundary: deliver, run one step, maybe finish.
export const runStepPlugin: ReactionPlugin<
  RunStepRequest,
  ScriptedModel | DeltaChannel
> = ({ command, query }) =>
  Effect.gen(function* () {
    const model = yield* ScriptedModel
    const deltas = yield* DeltaChannel
    return (request, delivery) =>
      Effect.gen(function* () {
        const { sessionID, ordinal } = request.payload

        // Requests are derived from state, so a duplicate or stale one can be
        // queued behind the job that already ran this boundary.
        const status = yield* query(stepStatus, { sessionID })
        if (!status.active) return
        // A step still in flight when a job starts belongs to a dead attempt:
        // the outbox worker runs one job at a time, so no live handler can own
        // it. The outbox does not tell the handler that its job was claimed
        // before, so the slice state is the evidence.
        if (status.stepInFlight) {
          if (
            status.inFlightStepID !== undefined &&
            ordinal === status.stepsStarted - 1
          )
            yield* reconcileOrphan(
              { command },
              {
                sessionID,
                assistantMessageID: status.inFlightStepID,
                deliveryId: delivery.deliveryId,
              },
            )
          return
        }
        // A request for a retry repeats the ordinal of the step that failed.
        const expected = status.lastFailure
          ? status.stepsStarted - 1
          : status.stepsStarted
        if (expected !== ordinal) return

        // Delivery law: steers (and, only at idle, queued items) enter history
        // at the safe-step boundary, before the next step starts.
        for (;;) {
          const next = yield* query(nextDeliverable, {
            sessionID,
            boundary: 'step',
          })
          if (next.item === null) break
          const delivered = yield* unlessRejected(
            command(
              {
                type: 'deliverInboxItem',
                payload: { sessionID, inboxID: next.item.inboxID },
              },
              {
                idempotencyKey: `${delivery.deliveryId}:deliver:${next.item.inboxID}`,
              },
            ),
          )
          if (!delivered) return
        }

        const assistantMessageID = `msg_${sessionID}_${ordinal}`
        const started = yield* unlessRejected(
          command(
            {
              type: 'recordStepStarted',
              payload: {
                sessionID,
                assistantMessageID,
                agent: 'build',
                model: { id: 'scripted', providerID: 'test' },
              },
            },
            { idempotencyKey: `${delivery.deliveryId}:started` },
          ),
        )
        if (!started) return

        const outcome = yield* model.next(sessionID)
        if (outcome.text !== undefined)
          yield* PubSub.publish(deltas.pubsub, {
            sessionID,
            type: 'session.text.delta' as const,
            text: outcome.text,
          })

        if (outcome.finish === 'error') {
          // Retry is narrow: the Plugin classifies, the Command owns the
          // budget and records either the scheduled retry or the failed
          // execution in the same commit as the step failure. A retry is
          // requested by the Reaction from that fact, not by this job.
          yield* unlessRejected(
            command(
              {
                type: 'recordStepFailed',
                payload: {
                  sessionID,
                  assistantMessageID,
                  error: outcome.error,
                  retryable: outcome.retryable,
                  // Backoff is recorded, not waited on: the scripted model
                  // has nothing to wait for.
                  at: Date.now(),
                },
              },
              { idempotencyKey: `${delivery.deliveryId}:failed` },
            ),
          )
          return
        }

        const ended = yield* unlessRejected(
          command(
            {
              type: 'recordStepEnded',
              payload: {
                sessionID,
                assistantMessageID,
                finish: outcome.finish,
              },
            },
            { idempotencyKey: `${delivery.deliveryId}:ended` },
          ),
        )
        if (!ended || outcome.finish !== 'stop') return

        yield* unlessRejected(
          command(
            { type: 'finishExecution', payload: { sessionID } },
            { idempotencyKey: `${delivery.deliveryId}:finished` },
          ),
        )
      })
  })

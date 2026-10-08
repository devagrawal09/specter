import {
  type ReactionPlugin,
  SpecterCommandRejectedError,
} from '@specter-ts/core'
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
        if (!status.active || status.stepInFlight) return
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
          const failed = yield* unlessRejected(
            command(
              {
                type: 'recordStepFailed',
                payload: {
                  sessionID,
                  assistantMessageID,
                  error: outcome.error,
                },
              },
              { idempotencyKey: `${delivery.deliveryId}:failed` },
            ),
          )
          if (!failed) return
          // Retry is narrow: only a retryable failure, within the Command's
          // budget. The next attempt is requested by the Reaction from the
          // scheduled-retry fact, not by this job.
          const retried =
            outcome.retryable &&
            (yield* unlessRejected(
              command(
                {
                  type: 'scheduleRetry',
                  payload: {
                    sessionID,
                    assistantMessageID,
                    // Backoff is recorded, not waited on: the scripted model
                    // has nothing to wait for.
                    at: Date.now(),
                  },
                },
                { idempotencyKey: `${delivery.deliveryId}:retry` },
              ),
            ))
          if (retried) return
          yield* unlessRejected(
            command(
              {
                type: 'finishExecution',
                payload: { sessionID, error: outcome.error },
              },
              { idempotencyKey: `${delivery.deliveryId}:finished` },
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

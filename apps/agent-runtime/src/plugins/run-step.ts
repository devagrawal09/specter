import {
  type ReactionPlugin,
  SpecterCommandRejectedError,
} from '@specter-ts/core'
import type { SessionID } from '@ocpp/schema/session-id'
import { Clock, Effect } from 'effect'

import { nextDeliverable } from '../features/session/next-deliverable-query/impl.ts'
import { nextStep } from '../features/session/next-step-query/impl.ts'
import type { RunStepRequest } from '../features/session/run-step-reaction/impl.ts'
import { stepStatus } from '../features/session/step-status-query/impl.ts'
import { modelTranscript } from '../features/session/model-transcript-query/impl.ts'
import { type RecordFailure, StepHost } from './step-host.ts'

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

// Orphan reconciliation (session.md: Execution Is Process-Local): settle the
// open tool calls as aborted, then fail the step the dead process left in
// flight. One Command records the failure and its outcome atomically: a scheduled retry, or the execution failing when the
// budget is spent. The retry's state-derived request starts the next physical
// attempt of the same step id; this job does not run the model.
const reconcileOrphan = (
  { command }: Pick<Parameters<ReactionPlugin<RunStepRequest>>[0], 'command'>,
  orphan: {
    sessionID: SessionID
    assistantMessageID: string
    deliveryId: string
    openCalls: readonly {
      assistantMessageID: string
      id: string
      name: string
      executed: boolean
    }[]
  },
) =>
  Effect.gen(function* () {
    const { sessionID, assistantMessageID, deliveryId, openCalls } = orphan
    // First settle every call the dead attempt left open, so the retried
    // attempt never replays a tool call without a result (OC++
    // settleStaleToolCalls: tool.failed { aborted }). A settle is a single
    // recorded fact, so a crash in this loop resumes with fewer open calls.
    for (const call of openCalls) {
      const settled = yield* unlessRejected(
        command(
          {
            type: 'settleToolCall',
            payload: {
              sessionID,
              assistantMessageID: call.assistantMessageID,
              id: call.id,
              executed: call.executed,
              error: {
                type: 'aborted',
                message: `Tool execution interrupted: ${call.name}`,
              },
            },
          },
          { idempotencyKey: `${deliveryId}:abort:${call.id}` },
        ),
      )
      if (!settled) return
    }
    yield* unlessRejected(
      command(
        {
          type: 'settleStep',
          payload: {
            sessionID,
            assistantMessageID,
            outcome: 'failed',
            error: {
              type: 'orphaned',
              message: 'Step was in flight when its process stopped',
            },
            retryable: true,
            at: yield* Clock.currentTimeMillis,
          },
        },
        { idempotencyKey: `${deliveryId}:orphaned` },
      ),
    )
  })

export type RunStepOptions = {
  // Plugin input: the assistant message ID of a Session's step. It must return
  // the same ID for the same Session and ordinal, because a retried attempt
  // reuses its step's ID. The default, msg_<sessionID>_<ordinal>, is unique
  // within one Event Log.
  readonly assistantMessageID?: (step: {
    readonly sessionID: string
    readonly ordinal: number
  }) => string
}

// One job = one safe-step boundary: deliver, run one step, maybe finish.
export const makeRunStepPlugin =
  (options: RunStepOptions = {}): ReactionPlugin<RunStepRequest, StepHost> =>
  ({ command, query }) =>
    Effect.gen(function* () {
      const host = yield* StepHost
      // Jobs run on the embedding's clock (a host's test clock included).
      const clock = yield* Clock.Clock
      return (request, delivery) =>
        Effect.gen(function* () {
          const { sessionID, ordinal } = request.payload
          // A failure outside a step fails the execution.
          const fail = (
            error: { readonly type: string; readonly message: string },
            idempotencyKey: string,
          ) =>
            unlessRejected(
              command(
                { type: 'failExecution', payload: { sessionID, error } },
                { idempotencyKey },
              ),
            )
          // Runs a compaction the host owns; false when the job should stop.
          const compact = (
            input: Parameters<typeof host.compact>[0],
            key: string,
          ) =>
            Effect.gen(function* () {
              const outcome = yield* host.compact(input)
              if (outcome.outcome === 'stopped') return false
              // A manual compaction that failed is recorded on its own item:
              // the execution goes on. The history must fit for a step, so an
              // automatic one that failed fails the execution.
              if (outcome.outcome === 'failed' && input.reason === 'auto') {
                yield* fail(outcome.error, `${key}:failed`)
                return false
              }
              return true
            })

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
                  openCalls: status.openCalls ?? [],
                },
              )
            return
          }
          // A request for a retry repeats the ordinal of the step that failed.
          const expected = status.retrying
            ? status.stepsStarted - 1
            : status.stepsStarted
          if (expected !== ordinal) return

          // Delivery law (OC++ runner): every pending steer enters history
          // before the next step; at an idle boundary (the execution's start,
          // or after a step that needed no continuation) with no steer
          // pending, one queued item may enter instead, with the steers that
          // arrive behind it.
          const {
            boundary,
            stepsInExecution,
            stepsSinceInput,
            retryAt,
            attempt,
          } = yield* query(nextStep, { sessionID })
          // A retried step waits until it is due: backoff is recorded with the
          // failure and honored here, one Session's job at a time.
          const now = yield* Clock.currentTimeMillis
          if (retryAt !== undefined && retryAt > now)
            yield* Effect.sleep(retryAt - now)
          let scope = boundary
          let delivered = 0
          // A delivered control item (compaction, move) is not input for a step.
          let controlled = false
          let prepared = false
          for (;;) {
            const next = yield* query(nextDeliverable, {
              sessionID,
              boundary: scope,
            })
            if (next.item === null) break
            const control =
              next.item.type === 'compaction' || next.item.type === 'move'
            if (!control && !prepared && host.prepare) {
              const ready = yield* host.prepare(sessionID)
              if (ready.outcome === 'failed') {
                yield* fail(ready.error, `${delivery.deliveryId}:unprepared`)
                return
              }
              prepared = true
              // Preparing can change what is pending (a cancelled input).
              continue
            }
            if (next.item.type === 'move' && host.moving)
              yield* host.moving(sessionID)
            const accepted = yield* unlessRejected(
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
            if (!accepted) return
            // A delivered compaction item compacts the history now; what
            // follows it is delivered after.
            if (next.item.type === 'compaction') {
              const settled = yield* compact(
                { sessionID, reason: 'manual', inputID: next.item.inboxID },
                `${delivery.deliveryId}:compaction:${next.item.inboxID}`,
              )
              if (!settled) return
              controlled = true
              continue
            }
            // A delivered move moved the Session: what follows runs in its
            // new Location.
            if (next.item.type === 'move') {
              controlled = true
              continue
            }
            delivered += 1
            // An idle boundary delivers its steers, or one queued item with the
            // steers that arrive behind it: never steers and a queued item.
            scope = 'step'
          }
          // An idle execution with nothing left to deliver is done.
          if (
            boundary === 'idle' &&
            (stepsInExecution > 0 || controlled) &&
            delivered === 0
          ) {
            yield* unlessRejected(
              command(
                { type: 'finishExecution', payload: { sessionID } },
                { idempotencyKey: `${delivery.deliveryId}:finished` },
              ),
            )
            return
          }

          const assistantMessageID =
            options.assistantMessageID?.({ sessionID, ordinal }) ??
            `msg_${sessionID}_${ordinal}`
          // The step's number since input was last delivered (the agent's step
          // limit counts these): delivered input starts again at 1, a retried
          // step keeps its number.
          const step =
            delivered > 0
              ? 1
              : retryAt !== undefined
                ? stepsSinceInput
                : stepsSinceInput + 1
          // The host compacts first when the history no longer fits.
          let plan = yield* host.begin({
            sessionID,
            assistantMessageID,
            ordinal,
            step,
            attempt,
            transcript: query(modelTranscript, { sessionID }),
          })
          for (let compactions = 1; 'compact' in plan; compactions++) {
            if (compactions > 2) {
              yield* fail(
                {
                  type: 'compaction.ineffective',
                  message: 'The history still does not fit after compacting',
                },
                `${delivery.deliveryId}:compaction-failed`,
              )
              return
            }
            const settled = yield* compact(
              { sessionID, reason: 'auto' },
              `${delivery.deliveryId}:compaction:auto:${compactions}`,
            )
            if (!settled) return
            plan = yield* host.begin({
              sessionID,
              assistantMessageID,
              ordinal,
              step,
              attempt,
              transcript: query(modelTranscript, { sessionID }),
            })
          }
          const key = delivery.deliveryId
          // The step starts with the attempt's first fact: an attempt that
          // ends without one produced nothing, and is not a step.
          let begun: boolean | undefined
          const started: Effect.Effect<boolean, RecordFailure> = Effect.suspend(
            () =>
              begun !== undefined
                ? Effect.succeed(begun)
                : unlessRejected(
                    command(
                      {
                        type: 'recordStepStarted',
                        payload: {
                          sessionID,
                          assistantMessageID,
                          agent: plan.agent,
                          model: plan.model,
                          ...(plan.snapshot === undefined
                            ? {}
                            : { snapshot: plan.snapshot }),
                        },
                      },
                      { idempotencyKey: `${key}:started` },
                    ),
                  ).pipe(
                    Effect.map((accepted) => {
                      begun = accepted
                      return accepted
                    }),
                  ),
          )
          const afterStart = (record: Effect.Effect<boolean, RecordFailure>) =>
            started.pipe(
              Effect.flatMap((accepted) =>
                accepted ? record : Effect.succeed(false),
              ),
            )
          const outcome = yield* plan.run({
            started: () => started,
            block: (block) =>
              afterStart(
                unlessRejected(
                  command(
                    {
                      type: 'recordBlock',
                      payload: { sessionID, assistantMessageID, ...block },
                    },
                    {
                      idempotencyKey: `${key}:block:${block.kind}:${block.ordinal}`,
                    },
                  ),
                ),
              ),
            toolRequested: (call) =>
              afterStart(
                unlessRejected(
                  command(
                    {
                      type: 'recordToolCall',
                      payload: { sessionID, assistantMessageID, ...call },
                    },
                    { idempotencyKey: `${key}:call:${call.id}` },
                  ),
                ),
              ),
            toolInputFailed: (failure) =>
              afterStart(
                unlessRejected(
                  command(
                    {
                      type: 'failToolInput',
                      payload: { sessionID, assistantMessageID, ...failure },
                    },
                    { idempotencyKey: `${key}:input-failed:${failure.id}` },
                  ),
                ),
              ),
            toolSettled: (result) =>
              afterStart(
                unlessRejected(
                  command(
                    {
                      type: 'settleToolCall',
                      payload: { sessionID, assistantMessageID, ...result },
                    },
                    { idempotencyKey: `${key}:result:${result.id}` },
                  ),
                ),
              ),
          })
          if (outcome.outcome === 'stopped') return
          if (outcome.outcome === 'interrupted') {
            yield* unlessRejected(
              command(
                { type: 'interruptExecution', payload: { sessionID } },
                { idempotencyKey: `${key}:interrupted` },
              ),
            )
            return
          }

          if (outcome.outcome === 'failed') {
            // A failure is a step's, even one before any output.
            if (!(yield* started)) return
            // Retry is narrow: the host classifies, the Command owns the
            // budget and records either the retry or the failed execution in
            // the same fact as the step failure. A retry is requested by the
            // Reaction from that fact, not by this job.
            const {
              outcome: _,
              retryable,
              retryDelay,
              fresh,
              limit,
              ...failure
            } = outcome
            yield* unlessRejected(
              command(
                {
                  type: 'settleStep',
                  payload: {
                    sessionID,
                    assistantMessageID,
                    outcome: 'failed',
                    ...failure,
                    retryable,
                    ...(fresh ? { fresh: true } : {}),
                    ...(limit === undefined ? {} : { limit }),
                    // The retry's due time: backoff is recorded, not waited on.
                    at: (yield* Clock.currentTimeMillis) + (retryDelay ?? 0),
                  },
                },
                { idempotencyKey: `${key}:failed` },
              ),
            )
            return
          }

          const { outcome: _, continue: next, ...success } = outcome
          // Nothing was produced, so no step ran: the execution is at its
          // idle boundary.
          const ended = !begun
            ? true
            : yield* unlessRejected(
                command(
                  {
                    type: 'settleStep',
                    payload: {
                      sessionID,
                      assistantMessageID,
                      outcome: 'succeeded',
                      ...success,
                      continues: next,
                    },
                  },
                  { idempotencyKey: `${key}:ended` },
                ),
              )
          if (!ended || (begun && next)) return
          // Input waiting for this idle boundary keeps the execution going: the
          // next step delivers it.
          const waiting = yield* query(nextDeliverable, {
            sessionID,
            boundary: 'idle',
          })
          if (waiting.item !== null) return

          yield* unlessRejected(
            command(
              { type: 'finishExecution', payload: { sessionID } },
              { idempotencyKey: `${key}:finished` },
            ),
          )
        }).pipe(Effect.provideService(Clock.Clock, clock))
    })

export const runStepPlugin = makeRunStepPlugin()

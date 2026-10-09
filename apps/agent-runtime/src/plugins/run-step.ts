import {
  type ReactionPlugin,
  SpecterCommandRejectedError,
} from '@specter-ts/core'
import type { SessionID } from '@ocpp/schema/session-id'
import type { Tool } from '@ocpp/codemode'
import { Effect, PubSub } from 'effect'

import { nextDeliverable } from '../features/session/next-deliverable-query/impl.ts'
import type { RunStepRequest } from '../features/session/run-step-reaction/impl.ts'
import { stepStatus } from '../features/session/step-status-query/impl.ts'
import { modelTranscript } from '../features/session/model-transcript-query/impl.ts'
import { executeToolSpec, runTool } from './code-mode-tool.ts'
import { DeltaChannel } from './delta-channel.ts'
import { Model } from './model.ts'

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
            at: Date.now(),
          },
        },
        { idempotencyKey: `${deliveryId}:orphaned` },
      ),
    )
  })

export const DEFAULT_SYSTEM_PROMPT =
  'You are a coding agent. Use the execute tool to run programs when it helps, then answer concisely.'

export type RunStepOptions = {
  // Plugin input: the system prompt of every model request.
  readonly system?: string
  // Plugin input: extra host tools exposed to Code Mode programs (scenario
  // tests use it to hold a program open). The model-visible spec is unchanged.
  readonly hostTools?: Record<string, Tool.Tool>
  // Plugin input: the assistant message ID of a Session's step. It must return
  // the same ID for the same Session and ordinal, because a retried attempt
  // reuses its step's ID. The default, msg_<sessionID>_<ordinal>, is unique
  // within one Event Log; a host whose message IDs outlive the log supplies its
  // own.
  readonly assistantMessageID?: (step: {
    readonly sessionID: string
    readonly ordinal: number
  }) => string
  // Plugin input: the agent recorded on each step (default `build`).
  readonly agent?: (sessionID: SessionID) => Effect.Effect<string>
}

// One job = one safe-step boundary: deliver, run one step, maybe finish.
export const makeRunStepPlugin =
  (
    options: RunStepOptions = {},
  ): ReactionPlugin<RunStepRequest, Model | DeltaChannel> =>
  ({ command, query }) =>
    Effect.gen(function* () {
      const model = yield* Model
      const deltas = yield* DeltaChannel
      const system = options.system ?? DEFAULT_SYSTEM_PROMPT
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
                  openCalls: status.openCalls ?? [],
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

          const assistantMessageID =
            options.assistantMessageID?.({ sessionID, ordinal }) ??
            `msg_${sessionID}_${ordinal}`
          const started = yield* unlessRejected(
            command(
              {
                type: 'recordStepStarted',
                payload: {
                  sessionID,
                  assistantMessageID,
                  agent: options.agent
                    ? yield* options.agent(sessionID)
                    : 'build',
                  model: {
                    ...(model.refFor
                      ? yield* model.refFor(sessionID)
                      : model.ref),
                  },
                },
              },
              { idempotencyKey: `${delivery.deliveryId}:started` },
            ),
          )
          if (!started) return

          // The model sees durable history only: the transcript Query is the
          // single source of the request messages.
          const transcript = yield* query(modelTranscript, { sessionID })
          const outcome = yield* model.nextOutcome({
            sessionID,
            system,
            messages: transcript.messages,
            tools: [executeToolSpec],
            onText: (text) =>
              PubSub.publish(deltas.pubsub, {
                sessionID,
                type: 'session.text.delta' as const,
                text,
              }).pipe(Effect.asVoid),
          })

          if (outcome.finish === 'error') {
            // Retry is narrow: the Plugin classifies, the Command owns the
            // budget and records either the scheduled retry or the failed
            // execution in the same commit as the step failure. A retry is
            // requested by the Reaction from that fact, not by this job.
            yield* unlessRejected(
              command(
                {
                  type: 'settleStep',
                  payload: {
                    sessionID,
                    assistantMessageID,
                    outcome: 'failed',
                    error: outcome.error,
                    retryable: outcome.retryable,
                    // Backoff is recorded, not waited on.
                    at: Date.now(),
                  },
                },
                { idempotencyKey: `${delivery.deliveryId}:failed` },
              ),
            )
            return
          }

          if (outcome.text) {
            const recorded = yield* unlessRejected(
              command(
                {
                  type: 'recordText',
                  payload: {
                    sessionID,
                    assistantMessageID,
                    ordinal: 0,
                    text: outcome.text,
                  },
                },
                { idempotencyKey: `${delivery.deliveryId}:text` },
              ),
            )
            if (!recorded) return
          }

          // Tool calls are durable before any side effect (session.md): record
          // every complete call first, then execute them one at a time.
          const calls = outcome.toolCalls ?? []
          for (const call of calls) {
            const recorded = yield* unlessRejected(
              command(
                {
                  type: 'recordToolCall',
                  payload: {
                    sessionID,
                    assistantMessageID,
                    id: call.id,
                    name: call.name,
                    input: call.input,
                  },
                },
                { idempotencyKey: `${delivery.deliveryId}:call:${call.id}` },
              ),
            )
            if (!recorded) return
          }
          for (const call of calls) {
            const settlement = yield* runTool(
              call.name,
              call.input,
              options.hostTools,
            )
            const settled = yield* unlessRejected(
              command(
                {
                  type: 'settleToolCall',
                  payload: {
                    sessionID,
                    assistantMessageID,
                    id: call.id,
                    ...(settlement.ok
                      ? { content: [{ type: 'text', text: settlement.text }] }
                      : { error: settlement.error }),
                  },
                },
                { idempotencyKey: `${delivery.deliveryId}:result:${call.id}` },
              ),
            )
            if (!settled) return
          }

          const ended = yield* unlessRejected(
            command(
              {
                type: 'settleStep',
                payload: {
                  sessionID,
                  assistantMessageID,
                  outcome: 'succeeded',
                  finish: outcome.finish,
                  ...(outcome.usage ? { tokens: outcome.usage } : {}),
                },
              },
              { idempotencyKey: `${delivery.deliveryId}:ended` },
            ),
          )
          if (!ended || outcome.finish === 'tool-calls') return

          yield* unlessRejected(
            command(
              { type: 'finishExecution', payload: { sessionID } },
              { idempotencyKey: `${delivery.deliveryId}:finished` },
            ),
          )
        })
    })

export const runStepPlugin = makeRunStepPlugin()

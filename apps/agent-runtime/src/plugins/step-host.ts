import type { LLM } from '@ocpp/schema/llm'
import type { SessionError } from '@ocpp/schema/session-error'
import type { SessionMessage } from '@ocpp/schema/session-message'
import type { Tool } from '@ocpp/schema/tool'
import type { TokenUsage } from '@ocpp/schema/token-usage'
import type { Tool as CodeModeTool } from '@ocpp/codemode'
import type { SpecterEffectError } from '@specter-ts/core'
import { Context, Effect, Layer, PubSub, type Schema } from 'effect'

import type { ModelMessage } from '../features/session/model-transcript-query/impl.ts'
import { executeToolSpec, runTool } from './code-mode-tool.ts'
import { DeltaChannel } from './delta-channel.ts'
import { Model } from './model.ts'

// A runtime failure while recording or reading (not a rejection). The host
// lets it fail the attempt, so the outbox retries the step's job.
export type RecordFailure = SpecterEffectError

// What one physical attempt of a step produces, recorded as it is produced.
// Each call records one fact through a runtime Command and answers false when
// the runtime rejected it: the world moved on (the execution was interrupted
// or settled), and the attempt should stop.
export type AttemptRecorder = {
  // Records the step as started, with the plan's agent, model and snapshot:
  // the attempt has begun producing. Recording a block or a call starts it
  // too, and so does a failure. An attempt that succeeds without starting
  // produced nothing, and records no step.
  readonly started: () => Effect.Effect<boolean, RecordFailure>
  readonly block: (block: {
    readonly kind: 'text' | 'reasoning'
    readonly ordinal: number
    readonly text: string
    readonly state?: SessionMessage.ProviderState
  }) => Effect.Effect<boolean, RecordFailure>
  // A complete call, recorded before it runs.
  readonly toolRequested: (call: {
    readonly id: string
    readonly name: string
    readonly input: Record<string, unknown>
    // The provider executes the call itself.
    readonly executed?: boolean
    readonly state?: SessionMessage.ProviderState
  }) => Effect.Effect<boolean, RecordFailure>
  // A call whose input never became one (it stopped streaming or never
  // parsed), failed with the raw input it had.
  readonly toolInputFailed: (failure: {
    readonly id: string
    readonly name: string
    readonly text?: string
    readonly error: SessionError.Error
    readonly executed?: boolean
    readonly metadata?: { readonly [key: string]: Schema.Json }
    readonly content?: readonly [Tool.Content, ...Tool.Content[]]
  }) => Effect.Effect<boolean, RecordFailure>
  readonly toolSettled: (
    result: {
      readonly id: string
      readonly executed?: boolean
      readonly metadata?: { readonly [key: string]: Schema.Json }
      readonly resultState?: SessionMessage.ProviderState
    } & (
      | { readonly content: readonly [Tool.Content, ...Tool.Content[]] }
      | {
          readonly error: SessionError.Error
          readonly content?: readonly [Tool.Content, ...Tool.Content[]]
        }
    ),
  ) => Effect.Effect<boolean, RecordFailure>
}

type Usage = {
  readonly rawFinish?: string
  readonly providerState?: SessionMessage.ProviderState
  readonly cost?: number
  readonly tokens?: TokenUsage.Info
  readonly snapshot?: string
  readonly files?: readonly string[]
}

// How an attempt ended. A failure's retry classification is the host's; the
// budget is the runtime's.
export type AttemptOutcome =
  | (Usage & {
      readonly outcome: 'succeeded'
      readonly finish: Exclude<LLM.FinishReason, 'error'>
      // Whether the Session needs another step (tool results to answer).
      readonly continue: boolean
    })
  | (Usage & {
      readonly outcome: 'failed'
      readonly error: SessionError.Error
      readonly retryable: boolean
      // How long a retry should wait (milliseconds); recorded as its due time.
      readonly retryDelay?: number
      // The retry runs as a new step: this attempt's output stands.
      readonly fresh?: true
      // The most retries the step may have, when the host's policy bounds
      // them itself.
      readonly limit?: number
      readonly finish?: 'content-filter'
    })
  // A record was rejected: nothing more is recorded for this attempt.
  | { readonly outcome: 'stopped' }
  // The attempt was interrupted on the user's behalf (a dismissed question):
  // what it produced is recorded, and the execution is interrupted.
  | { readonly outcome: 'interrupted' }

// How a compaction the host ran ended. Its own facts (started, ended or
// failed, usage) are the host's; the runtime decides when it runs.
export type CompactionOutcome =
  | { readonly outcome: 'completed' }
  // `fatal`: the compaction itself broke (not an outcome it records), so even
  // a manual one fails the execution.
  | {
      readonly outcome: 'failed'
      readonly error: SessionError.Error
      readonly fatal?: true
    }
  // The execution moved on while it ran.
  | { readonly outcome: 'stopped' }

// Whether the Session is ready for input to be delivered.
export type PrepareOutcome =
  | { readonly outcome: 'ready' }
  | { readonly outcome: 'failed'; readonly error: SessionError.Error }

// The history no longer fits the model: compact before the step.
export type CompactFirst = { readonly compact: true }

// One step, as the host prepares it: what step.started records, and the
// attempt itself.
export type StepPlan = {
  readonly agent: string
  readonly model: { readonly id: string; readonly providerID: string }
  readonly snapshot?: string
  readonly run: (
    record: AttemptRecorder,
  ) => Effect.Effect<AttemptOutcome, RecordFailure>
}

// The step's I/O: building the request, calling the model, executing tools.
// The step Plugin owns everything around it (delivery, the step lifecycle, the
// retry budget, finishing), and every fact goes through the recorder.
export class StepHost extends Context.Service<
  StepHost,
  {
    readonly begin: (input: {
      readonly sessionID: string
      readonly assistantMessageID: string
      readonly ordinal: number
      // The step's number since input was last delivered, from 1.
      readonly step: number
      // Which attempt of that step this is, from 1.
      readonly attempt: number
      // The runtime's model transcript at the moment the attempt runs.
      readonly transcript: Effect.Effect<
        { readonly messages: ModelMessage[] },
        RecordFailure
      >
    }) => Effect.Effect<StepPlan | CompactFirst>
    // Called before input is delivered, so what the host records about the
    // Session's context (OC++'s instruction changes) precedes that input in
    // history. A failure fails the execution and leaves the input pending.
    readonly prepare?: (sessionID: string) => Effect.Effect<PrepareOutcome>
    // Called before a move item is delivered, so the host can release what
    // it holds for the Session's current Location.
    readonly moving?: (sessionID: string) => Effect.Effect<void>
    // Called when a step was left in flight by an attempt that died, before
    // the runtime settles what it left open: the host settles the tool calls
    // it knows more about (OC++'s delegated child Sessions) first.
    readonly recover?: (sessionID: string) => Effect.Effect<void>
    // Compacts the Session's history: manually, for a delivered compaction
    // item, or automatically, when begin asked for it.
    readonly compact: (input: {
      readonly sessionID: string
      readonly reason: 'auto' | 'manual'
      readonly inputID?: string
    }) => Effect.Effect<CompactionOutcome>
  }
>()('@specter/agent-runtime/StepHost') {}

export const DEFAULT_SYSTEM_PROMPT =
  'You are a coding agent. Use the execute tool to run programs when it helps, then answer concisely.'

export type ModelStepHostOptions = {
  // The system prompt of every model request.
  readonly system?: string
  // Extra host tools exposed to Code Mode programs (scenario tests use it to
  // hold a program open). The model-visible spec is unchanged.
  readonly hostTools?: Record<string, CodeModeTool.Tool>
  // The agent recorded on each step (default `build`).
  readonly agent?: (sessionID: string) => Effect.Effect<string>
}

// The runtime's own step I/O: the Model port over the runtime's transcript,
// with Code Mode's `execute` as the only tool. Text deltas go to the
// DeltaChannel.
export const modelStepHostLayer = (options: ModelStepHostOptions = {}) =>
  Layer.effect(
    StepHost,
    Effect.gen(function* () {
      const model = yield* Model
      const deltas = yield* DeltaChannel
      const system = options.system ?? DEFAULT_SYSTEM_PROMPT
      return StepHost.of({
        // The runtime's own model has no compaction.
        compact: () =>
          Effect.succeed({
            outcome: 'failed',
            error: {
              type: 'compaction.unavailable',
              message: 'This runtime cannot compact a Session',
            },
          } as const),
        begin: ({ sessionID, transcript }) =>
          Effect.gen(function* () {
            const agent = options.agent
              ? yield* options.agent(sessionID)
              : 'build'
            const ref = model.refFor
              ? yield* model.refFor(sessionID)
              : model.ref
            return {
              agent,
              model: { id: ref.id, providerID: ref.providerID },
              run: (record) =>
                Effect.gen(function* () {
                  // Every model call of this runtime is a step.
                  if (!(yield* record.started())) return { outcome: 'stopped' }
                  // The model sees durable history only: the transcript Query
                  // is the single source of the request messages.
                  const { messages } = yield* transcript
                  const outcome = yield* model.nextOutcome({
                    sessionID,
                    system,
                    messages,
                    tools: [executeToolSpec],
                    onText: (text) =>
                      PubSub.publish(deltas.pubsub, {
                        sessionID,
                        type: 'session.text.delta' as const,
                        text,
                      }).pipe(Effect.asVoid),
                  })
                  if (outcome.finish === 'error')
                    return {
                      outcome: 'failed',
                      error: outcome.error,
                      retryable: outcome.retryable,
                    } as const
                  const stopped = { outcome: 'stopped' } as const
                  if (
                    outcome.text &&
                    !(yield* record.block({
                      kind: 'text',
                      ordinal: 0,
                      text: outcome.text,
                    }))
                  )
                    return stopped
                  // Tool calls are durable before any side effect (session.md):
                  // record every complete call first, then execute them one at
                  // a time.
                  const calls = outcome.toolCalls ?? []
                  for (const call of calls)
                    if (!(yield* record.toolRequested(call))) return stopped
                  for (const call of calls) {
                    const settlement = yield* runTool(
                      call.name,
                      call.input,
                      options.hostTools,
                    )
                    const settled = yield* record.toolSettled(
                      settlement.ok
                        ? {
                            id: call.id,
                            content: [{ type: 'text', text: settlement.text }],
                          }
                        : { id: call.id, error: settlement.error },
                    )
                    if (!settled) return stopped
                  }
                  return {
                    outcome: 'succeeded',
                    finish: outcome.finish,
                    continue: outcome.finish === 'tool-calls',
                    ...(outcome.usage ? { tokens: outcome.usage } : {}),
                  } as const
                }),
            }
          }),
      })
    }),
  )

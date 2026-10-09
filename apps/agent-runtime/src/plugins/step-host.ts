import type { LLM } from '@ocpp/schema/llm'
import type { SessionError } from '@ocpp/schema/session-error'
import type { SessionMessage } from '@ocpp/schema/session-message'
import type { Tool } from '@ocpp/schema/tool'
import type { TokenUsage } from '@ocpp/schema/token-usage'
import type { Tool as CodeModeTool } from '@ocpp/codemode'
import type { SpecterEffectError } from '@specter-ts/core'
import { Context, Effect, Layer, PubSub } from 'effect'

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
  readonly block: (block: {
    readonly kind: 'text' | 'reasoning'
    readonly ordinal: number
    readonly text: string
  }) => Effect.Effect<boolean, RecordFailure>
  // A complete call, recorded before it runs.
  readonly toolRequested: (call: {
    readonly id: string
    readonly name: string
    readonly input: Record<string, unknown>
  }) => Effect.Effect<boolean, RecordFailure>
  readonly toolSettled: (
    result: { readonly id: string; readonly executed?: boolean } & (
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
      readonly finish?: 'content-filter'
    })
  // A record was rejected: nothing more is recorded for this attempt.
  | { readonly outcome: 'stopped' }

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
      // The runtime's model transcript at the moment the attempt runs.
      readonly transcript: Effect.Effect<
        { readonly messages: ModelMessage[] },
        RecordFailure
      >
    }) => Effect.Effect<StepPlan>
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

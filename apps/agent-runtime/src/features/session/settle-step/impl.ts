import { LLM } from '@ocpp/schema/llm'
import { Money } from '@ocpp/schema/money'
import { NonNegativeInt, RelativePath } from '@ocpp/schema/schema'
import { SessionError } from '@ocpp/schema/session-error'
import { SessionID } from '@ocpp/schema/session-id'
import { SessionMessage } from '@ocpp/schema/session-message'
import { Snapshot } from '@ocpp/schema/snapshot'
import { TokenUsage } from '@ocpp/schema/token-usage'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

const DEFAULT_LIMIT = 3

// Rebuildable projection: active executions and, per step, whether an attempt
// is in flight and how many retries it has had. A step id is reused by retried
// attempts, so a new step-started puts it back in flight and keeps the count.
export type SettleStepState = {
  active: Record<string, true>
  // Retries a fresh retry carries into the Session's next step.
  carried: Record<string, number>
  steps: Record<
    string,
    { sessionID: string; status: 'started' | 'settled'; retries: number }
  >
}

export const settleStepStore = Context.Service<
  SliceStoreService<SettleStepState, SettleStepState, unknown>
>('@specter/agent-runtime/SettleStepStore')

export const createSettleStepState = (): SettleStepState => ({
  active: {},
  carried: {},
  steps: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')
const stepStarted = sessionEvent('session-step-started')
const stepSettled = sessionEvent('session-step-settled')

const target = {
  sessionID: SessionID,
  assistantMessageID: SessionMessage.ID,
}
// What the host observed of the attempt, recorded as given.
const observed = {
  rawFinish: Schema.optional(Schema.String),
  providerState: Schema.optional(SessionMessage.ProviderState),
  cost: Schema.optional(Money.USD),
  tokens: Schema.optional(TokenUsage.Info),
  snapshot: Schema.optional(Snapshot.ID),
  files: Schema.optional(Schema.Array(RelativePath)),
}
const input = Schema.toStandardSchemaV1(
  Schema.Union([
    Schema.Struct({
      ...target,
      ...observed,
      outcome: Schema.Literal('succeeded'),
      finish: LLM.FinishReason,
      continues: Schema.optional(Schema.Boolean),
    }),
    Schema.Struct({
      ...target,
      ...observed,
      outcome: Schema.Literal('failed'),
      error: SessionError.Error,
      finish: Schema.optional(Schema.Literals(['content-filter'])),
      // Retry classification is the caller's; the budget and the outcome are
      // this Command's.
      retryable: Schema.Boolean,
      // Retry as a new step: this attempt's output stands.
      fresh: Schema.optional(Schema.Boolean),
      limit: Schema.optional(NonNegativeInt),
      at: NonNegativeInt,
    }),
  ]),
)

// Optional keys stay absent rather than undefined in recorded payloads.
const defined = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

const zeroTokens = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}

export const settleStep = implementCommand(specification)
  .inputSchema(input)
  .store(settleStepStore)
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSettled, async (event, state) => {
    delete state.active[event.payload.sessionID]
    delete state.carried[event.payload.sessionID]
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    const step = state.steps[assistantMessageID]
    if (step) step.status = 'started'
    else
      state.steps[assistantMessageID] = {
        sessionID,
        status: 'started',
        retries: state.carried[sessionID] ?? 0,
      }
    delete state.carried[sessionID]
  })
  .apply(stepSettled, async (event, state) => {
    const step = state.steps[event.payload.assistantMessageID]
    if (!step) return
    step.status = 'settled'
    if (event.payload.outcome !== 'failed' || !event.payload.retry) return
    step.retries += 1
    if (event.payload.retry.fresh)
      state.carried[event.payload.sessionID] = step.retries
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    const step = state.steps[command.assistantMessageID]
    if (!step || step.sessionID !== command.sessionID)
      throw new Error('Step not started')
    if (step.status === 'settled') throw new Error('Step already settled')
    const { sessionID, assistantMessageID } = command
    const recorded = {
      ...defined('rawFinish', command.rawFinish),
      ...defined('providerState', command.providerState),
      ...defined('snapshot', command.snapshot),
      ...defined('files', command.files),
    }
    if (command.outcome === 'succeeded')
      return [
        stepSettled.create({
          sessionID,
          assistantMessageID,
          outcome: 'succeeded',
          finish: command.finish,
          ...(command.continues ? { continues: true as const } : {}),
          ...recorded,
          cost: command.cost ?? Money.USD.make(0),
          tokens: command.tokens ?? zeroTokens,
        }),
      ]
    const failure = {
      sessionID,
      assistantMessageID,
      outcome: 'failed' as const,
      error: command.error,
      ...defined('finish', command.finish),
      ...recorded,
      ...defined('cost', command.cost),
      ...defined('tokens', command.tokens),
    }
    // One commit, one outcome: the failure and its consequence cannot be torn
    // apart by a crash.
    if (command.retryable && step.retries < (command.limit ?? DEFAULT_LIMIT))
      return [
        stepSettled.create({
          ...failure,
          retry: {
            attempt: step.retries + 1,
            at: command.at,
            ...(command.fresh ? { fresh: true as const } : {}),
          },
        }),
      ]
    return [
      stepSettled.create(failure),
      executionSettled.create({
        sessionID,
        outcome: 'failed',
        error: command.error,
      }),
    ]
  })

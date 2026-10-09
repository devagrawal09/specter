import { LLM } from '@ocpp/schema/llm'
import { Money } from '@ocpp/schema/money'
import { NonNegativeInt } from '@ocpp/schema/schema'
import { SessionError } from '@ocpp/schema/session-error'
import { SessionID } from '@ocpp/schema/session-id'
import { SessionMessage } from '@ocpp/schema/session-message'
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
const input = Schema.toStandardSchemaV1(
  Schema.Union([
    Schema.Struct({
      ...target,
      outcome: Schema.Literal('succeeded'),
      finish: LLM.FinishReason,
      cost: Schema.optional(Money.USD),
      tokens: Schema.optional(TokenUsage.Info),
    }),
    Schema.Struct({
      ...target,
      outcome: Schema.Literal('failed'),
      error: SessionError.Error,
      finish: Schema.optional(Schema.Literals(['content-filter'])),
      rawFinish: Schema.optional(Schema.String),
      cost: Schema.optional(Money.USD),
      tokens: Schema.optional(TokenUsage.Info),
      // Retry classification is the caller's; the budget and the outcome are
      // this Command's.
      retryable: Schema.Boolean,
      limit: Schema.optional(NonNegativeInt),
      at: NonNegativeInt,
    }),
  ]),
)

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
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    const step = state.steps[assistantMessageID]
    if (step) step.status = 'started'
    else
      state.steps[assistantMessageID] = {
        sessionID,
        status: 'started',
        retries: 0,
      }
  })
  .apply(stepSettled, async (event, state) => {
    const step = state.steps[event.payload.assistantMessageID]
    if (!step) return
    step.status = 'settled'
    if (event.payload.outcome === 'failed' && event.payload.retry)
      step.retries += 1
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    const step = state.steps[command.assistantMessageID]
    if (!step || step.sessionID !== command.sessionID)
      throw new Error('Step not started')
    if (step.status === 'settled') throw new Error('Step already settled')
    const { sessionID, assistantMessageID } = command
    if (command.outcome === 'succeeded')
      return [
        stepSettled.create({
          sessionID,
          assistantMessageID,
          outcome: 'succeeded',
          finish: command.finish,
          cost: command.cost ?? Money.USD.make(0),
          tokens: command.tokens ?? zeroTokens,
        }),
      ]
    const failure = {
      sessionID,
      assistantMessageID,
      outcome: 'failed' as const,
      error: command.error,
      ...(command.finish === undefined ? {} : { finish: command.finish }),
      ...(command.rawFinish === undefined
        ? {}
        : { rawFinish: command.rawFinish }),
      ...(command.cost === undefined ? {} : { cost: command.cost }),
      ...(command.tokens === undefined ? {} : { tokens: command.tokens }),
    }
    // One commit, one outcome: the failure and its consequence cannot be torn
    // apart by a crash.
    if (command.retryable && step.retries < (command.limit ?? DEFAULT_LIMIT))
      return [
        stepSettled.create({
          ...failure,
          retry: { attempt: step.retries + 1, at: command.at },
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

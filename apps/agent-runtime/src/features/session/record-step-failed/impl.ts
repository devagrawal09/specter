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

// Rebuildable projection: active executions and, per step, its status and how
// many retries were scheduled. A step id is reused by retried attempts, so a
// new step-started puts it back to 'started' and keeps the retry count.
export type RecordStepFailedState = {
  active: Record<string, true>
  steps: Record<
    string,
    {
      sessionID: string
      status: 'started' | 'ended' | 'failed' | 'retrying'
      retries: number
    }
  >
}

export const recordStepFailedStore = Context.Service<
  SliceStoreService<RecordStepFailedState, RecordStepFailedState, unknown>
>('@specter/agent-runtime/RecordStepFailedStore')

export const createRecordStepFailedState = (): RecordStepFailedState => ({
  active: {},
  steps: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSucceeded = sessionEvent('session-execution-succeeded')
const executionFailed = sessionEvent('session-execution-failed')
const executionInterrupted = sessionEvent('session-execution-interrupted')
const stepStarted = sessionEvent('session-step-started')
const stepEnded = sessionEvent('session-step-ended')
const stepFailed = sessionEvent('session-step-failed')
const retryScheduled = sessionEvent('session-retry-scheduled')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: SessionID,
    assistantMessageID: SessionMessage.ID,
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
)

const end = (state: RecordStepFailedState, sessionID: string) => {
  delete state.active[sessionID]
}

export const recordStepFailed = implementCommand(specification)
  .inputSchema(input)
  .store(recordStepFailedStore)
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSucceeded, async (event, state) => {
    end(state, event.payload.sessionID)
  })
  .apply(executionFailed, async (event, state) => {
    end(state, event.payload.sessionID)
  })
  .apply(executionInterrupted, async (event, state) => {
    end(state, event.payload.sessionID)
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
  .apply(stepEnded, async (event, state) => {
    const step = state.steps[event.payload.assistantMessageID]
    if (step) step.status = 'ended'
  })
  .apply(stepFailed, async (event, state) => {
    const step = state.steps[event.payload.assistantMessageID]
    if (step) step.status = 'failed'
  })
  .apply(retryScheduled, async (event, state) => {
    const step = state.steps[event.payload.assistantMessageID]
    if (!step) return
    step.status = 'retrying'
    step.retries += 1
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    const step = state.steps[command.assistantMessageID]
    if (!step || step.sessionID !== command.sessionID)
      throw new Error('Step not started')
    if (step.status === 'ended') throw new Error('Step already ended')
    if (step.status === 'failed' || step.status === 'retrying')
      throw new Error('Step already failed')
    const failure = [
      stepFailed.create({
        sessionID: command.sessionID,
        assistantMessageID: command.assistantMessageID,
        error: command.error,
        ...(command.finish === undefined ? {} : { finish: command.finish }),
        ...(command.rawFinish === undefined
          ? {}
          : { rawFinish: command.rawFinish }),
        ...(command.cost === undefined ? {} : { cost: command.cost }),
        ...(command.tokens === undefined ? {} : { tokens: command.tokens }),
      }),
    ]
    // One commit, one outcome: the failure and its consequence cannot be torn
    // apart by a crash.
    if (command.retryable && step.retries < (command.limit ?? DEFAULT_LIMIT))
      return [
        ...failure,
        retryScheduled.create({
          sessionID: command.sessionID,
          assistantMessageID: command.assistantMessageID,
          attempt: step.retries + 1,
          at: command.at,
          error: command.error,
        }),
      ]
    return [
      ...failure,
      executionFailed.create({
        sessionID: command.sessionID,
        error: command.error,
      }),
    ]
  })

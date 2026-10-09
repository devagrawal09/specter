import { LLM } from '@ocpp/schema/llm'
import { Money } from '@ocpp/schema/money'
import { SessionID } from '@ocpp/schema/session-id'
import { SessionMessage } from '@ocpp/schema/session-message'
import { TokenUsage } from '@ocpp/schema/token-usage'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: active executions and each step's status. Duplicated
// from record-step-started on purpose.
export type RecordStepEndedState = {
  active: Record<string, true>
  steps: Record<string, { sessionID: string; status: 'started' | 'ended' }>
}

export const recordStepEndedStore = Context.Service<
  SliceStoreService<RecordStepEndedState, RecordStepEndedState, unknown>
>('@specter/agent-runtime/RecordStepEndedStore')

export const createRecordStepEndedState = (): RecordStepEndedState => ({
  active: {},
  steps: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')
const stepStarted = sessionEvent('session-step-started')
const stepEnded = sessionEvent('session-step-ended')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: SessionID,
    assistantMessageID: SessionMessage.ID,
    finish: LLM.FinishReason,
    cost: Schema.optional(Money.USD),
    tokens: Schema.optional(TokenUsage.Info),
  }),
)

const end = (state: RecordStepEndedState, sessionID: string) => {
  delete state.active[sessionID]
}

export const recordStepEnded = implementCommand(specification)
  .inputSchema(input)
  .store(recordStepEndedStore)
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSettled, async (event, state) => {
    end(state, event.payload.sessionID)
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    state.steps[assistantMessageID] = { sessionID, status: 'started' }
  })
  .apply(stepEnded, async (event, state) => {
    const step = state.steps[event.payload.assistantMessageID]
    if (step) step.status = 'ended'
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    const step = state.steps[command.assistantMessageID]
    if (!step || step.sessionID !== command.sessionID)
      throw new Error('Step not started')
    if (step.status === 'ended') throw new Error('Step already ended')
    return [
      stepEnded.create({
        sessionID: command.sessionID,
        assistantMessageID: command.assistantMessageID,
        finish: command.finish,
        cost: command.cost ?? Money.USD.make(0),
        tokens: command.tokens ?? {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      }),
    ]
  })

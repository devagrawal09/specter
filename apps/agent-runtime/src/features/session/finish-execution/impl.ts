import { SessionID } from '@ocpp/schema/session-id'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: active executions and the step in flight per
// Session. Duplicated from record-step-started on purpose.
export type FinishExecutionState = {
  active: Record<string, true>
  inFlight: Record<string, string>
}

export const finishExecutionStore = Context.Service<
  SliceStoreService<FinishExecutionState, FinishExecutionState, unknown>
>('@specter/agent-runtime/FinishExecutionStore')

export const createFinishExecutionState = (): FinishExecutionState => ({
  active: {},
  inFlight: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSucceeded = sessionEvent('session-execution-succeeded')
const executionFailed = sessionEvent('session-execution-failed')
const executionInterrupted = sessionEvent('session-execution-interrupted')
const stepStarted = sessionEvent('session-step-started')
const stepEnded = sessionEvent('session-step-ended')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

const settle = (state: FinishExecutionState, sessionID: string) => {
  delete state.active[sessionID]
  delete state.inFlight[sessionID]
}

export const finishExecution = implementCommand(specification)
  .inputSchema(input)
  .store(finishExecutionStore)
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSucceeded, async (event, state) => {
    settle(state, event.payload.sessionID)
  })
  .apply(executionFailed, async (event, state) => {
    settle(state, event.payload.sessionID)
  })
  .apply(executionInterrupted, async (event, state) => {
    settle(state, event.payload.sessionID)
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    state.inFlight[sessionID] = assistantMessageID
  })
  .apply(stepEnded, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    if (state.inFlight[sessionID] === assistantMessageID)
      delete state.inFlight[sessionID]
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    if (state.inFlight[command.sessionID]) throw new Error('Step in flight')
    return [executionSucceeded.create({ sessionID: command.sessionID })]
  })

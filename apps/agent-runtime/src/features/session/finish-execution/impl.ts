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
const executionSettled = sessionEvent('session-execution-settled')
const stepStarted = sessionEvent('session-step-started')
const stepSettled = sessionEvent('session-step-settled')

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
  .apply(executionSettled, async (event, state) => {
    settle(state, event.payload.sessionID)
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    state.inFlight[sessionID] = assistantMessageID
  })
  // A settled step is no longer in flight, even one whose failure is retried:
  // a retried attempt that produces nothing leaves the failure standing, and
  // the execution may finish.
  .apply(stepSettled, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    if (state.inFlight[sessionID] === assistantMessageID)
      delete state.inFlight[sessionID]
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    if (state.inFlight[command.sessionID]) throw new Error('Step in flight')
    return [
      executionSettled.create({
        sessionID: command.sessionID,
        outcome: 'succeeded',
      }),
    ]
  })

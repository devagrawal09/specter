import { SessionID } from '@ocpp/schema/session-id'
import { SessionMessage } from '@ocpp/schema/session-message'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: active executions and the in-flight step per
// Session, with whether its current attempt has streamed. Duplicated from the
// other step Slices on purpose.
export type RecordStepStreamedState = {
  active: Record<string, true>
  inFlight: Record<string, { assistantMessageID: string; streamed: boolean }>
}

export const recordStepStreamedStore = Context.Service<
  SliceStoreService<RecordStepStreamedState, RecordStepStreamedState, unknown>
>('@specter/agent-runtime/RecordStepStreamedStore')

export const createRecordStepStreamedState = (): RecordStepStreamedState => ({
  active: {},
  inFlight: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')
const stepStarted = sessionEvent('session-step-started')
const stepStreamed = sessionEvent('session-step-streamed')
const stepSettled = sessionEvent('session-step-settled')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: SessionID,
    assistantMessageID: SessionMessage.ID,
  }),
)

const settle = (state: RecordStepStreamedState, sessionID: string) => {
  delete state.active[sessionID]
  delete state.inFlight[sessionID]
}

export const recordStepStreamed = implementCommand(specification)
  .inputSchema(input)
  .store(recordStepStreamedStore)
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSettled, async (event, state) => {
    settle(state, event.payload.sessionID)
  })
  // Every step.started opens a physical attempt, which streams once.
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    state.inFlight[sessionID] = { assistantMessageID, streamed: false }
  })
  .apply(stepStreamed, async (event, state) => {
    const step = state.inFlight[event.payload.sessionID]
    if (step?.assistantMessageID === event.payload.assistantMessageID)
      step.streamed = true
  })
  .apply(stepSettled, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    if (state.inFlight[sessionID]?.assistantMessageID === assistantMessageID)
      delete state.inFlight[sessionID]
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    const step = state.inFlight[command.sessionID]
    if (step?.assistantMessageID !== command.assistantMessageID)
      throw new Error('Step not in flight')
    if (step.streamed) throw new Error('Step already streamed')
    return [
      stepStreamed.create({
        sessionID: command.sessionID,
        assistantMessageID: command.assistantMessageID,
      }),
    ]
  })

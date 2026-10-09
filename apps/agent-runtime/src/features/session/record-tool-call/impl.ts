import { SessionID } from '@ocpp/schema/session-id'
import { SessionMessage } from '@ocpp/schema/session-message'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: active executions, the in-flight step per Session
// and the call ids recorded in its current attempt. Duplicated on purpose.
export type RecordToolCallState = {
  active: Record<string, true>
  inFlight: Record<string, { assistantMessageID: string; calls: string[] }>
}

export const recordToolCallStore = Context.Service<
  SliceStoreService<RecordToolCallState, RecordToolCallState, unknown>
>('@specter/agent-runtime/RecordToolCallStore')

export const createRecordToolCallState = (): RecordToolCallState => ({
  active: {},
  inFlight: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')
const stepStarted = sessionEvent('session-step-started')
const stepEnded = sessionEvent('session-step-ended')
const stepFailed = sessionEvent('session-step-failed')
const retryScheduled = sessionEvent('session-retry-scheduled')
const inputStarted = sessionEvent('session-tool-input-started')
const inputEnded = sessionEvent('session-tool-input-ended')
const toolCalled = sessionEvent('session-tool-called')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: SessionID,
    assistantMessageID: SessionMessage.ID,
    id: Schema.String,
    name: Schema.String,
    input: Schema.Record(Schema.String, Schema.Unknown),
  }),
)

const settle = (state: RecordToolCallState, sessionID: string) => {
  delete state.active[sessionID]
  delete state.inFlight[sessionID]
}

const closeStep = (
  state: RecordToolCallState,
  sessionID: string,
  assistantMessageID: string,
) => {
  if (state.inFlight[sessionID]?.assistantMessageID === assistantMessageID)
    delete state.inFlight[sessionID]
}

export const recordToolCall = implementCommand(specification)
  .inputSchema(input)
  .store(recordToolCallStore)
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSettled, async (event, state) => {
    settle(state, event.payload.sessionID)
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    state.inFlight[sessionID] = { assistantMessageID, calls: [] }
  })
  .apply(stepEnded, async (event, state) => {
    closeStep(state, event.payload.sessionID, event.payload.assistantMessageID)
  })
  .apply(stepFailed, async (event, state) => {
    closeStep(state, event.payload.sessionID, event.payload.assistantMessageID)
  })
  .apply(retryScheduled, async () => {})
  .apply(inputStarted, async () => {})
  .apply(inputEnded, async () => {})
  .apply(toolCalled, async (event, state) => {
    const { sessionID, assistantMessageID, id } = event.payload
    const step = state.inFlight[sessionID]
    if (step?.assistantMessageID === assistantMessageID) step.calls.push(id)
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    const step = state.inFlight[command.sessionID]
    if (step?.assistantMessageID !== command.assistantMessageID)
      throw new Error('Step not in flight')
    if (step.calls.includes(command.id))
      throw new Error('Tool call already recorded')
    const base = {
      sessionID: command.sessionID,
      assistantMessageID: command.assistantMessageID,
      id: command.id,
    }
    return [
      inputStarted.create({ ...base, name: command.name }),
      inputEnded.create({ ...base, text: JSON.stringify(command.input) }),
      toolCalled.create({ ...base, input: command.input, executed: false }),
    ]
  })

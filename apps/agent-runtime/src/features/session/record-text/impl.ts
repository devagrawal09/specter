import { NonNegativeInt } from '@ocpp/schema/schema'
import { SessionID } from '@ocpp/schema/session-id'
import { SessionMessage } from '@ocpp/schema/session-message'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: active executions, the in-flight step per Session
// and the text ordinals recorded in its current attempt. Duplicated from the
// other step Slices on purpose.
export type RecordTextState = {
  active: Record<string, true>
  inFlight: Record<string, { assistantMessageID: string; ordinals: number[] }>
}

export const recordTextStore = Context.Service<
  SliceStoreService<RecordTextState, RecordTextState, unknown>
>('@specter/agent-runtime/RecordTextStore')

export const createRecordTextState = (): RecordTextState => ({
  active: {},
  inFlight: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSucceeded = sessionEvent('session-execution-succeeded')
const executionFailed = sessionEvent('session-execution-failed')
const executionInterrupted = sessionEvent('session-execution-interrupted')
const stepStarted = sessionEvent('session-step-started')
const stepEnded = sessionEvent('session-step-ended')
const stepFailed = sessionEvent('session-step-failed')
const retryScheduled = sessionEvent('session-retry-scheduled')
const textStarted = sessionEvent('session-text-started')
const textEnded = sessionEvent('session-text-ended')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: SessionID,
    assistantMessageID: SessionMessage.ID,
    ordinal: NonNegativeInt,
    text: Schema.String,
  }),
)

const settle = (state: RecordTextState, sessionID: string) => {
  delete state.active[sessionID]
  delete state.inFlight[sessionID]
}

const closeStep = (
  state: RecordTextState,
  sessionID: string,
  assistantMessageID: string,
) => {
  if (state.inFlight[sessionID]?.assistantMessageID === assistantMessageID)
    delete state.inFlight[sessionID]
}

export const recordText = implementCommand(specification)
  .inputSchema(input)
  .store(recordTextStore)
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
  // Every step.started opens a physical attempt with fresh ordinals.
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    state.inFlight[sessionID] = { assistantMessageID, ordinals: [] }
  })
  .apply(stepEnded, async (event, state) => {
    closeStep(state, event.payload.sessionID, event.payload.assistantMessageID)
  })
  .apply(stepFailed, async (event, state) => {
    closeStep(state, event.payload.sessionID, event.payload.assistantMessageID)
  })
  .apply(retryScheduled, async () => {})
  .apply(textStarted, async () => {})
  .apply(textEnded, async (event, state) => {
    const { sessionID, assistantMessageID, ordinal } = event.payload
    const step = state.inFlight[sessionID]
    if (step?.assistantMessageID === assistantMessageID)
      step.ordinals.push(ordinal)
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    const step = state.inFlight[command.sessionID]
    if (step?.assistantMessageID !== command.assistantMessageID)
      throw new Error('Step not in flight')
    if (command.text === '') throw new Error('Text is empty')
    if (step.ordinals.includes(command.ordinal))
      throw new Error('Text already recorded')
    return [
      textStarted.create({
        sessionID: command.sessionID,
        assistantMessageID: command.assistantMessageID,
        ordinal: command.ordinal,
      }),
      textEnded.create({
        sessionID: command.sessionID,
        assistantMessageID: command.assistantMessageID,
        ordinal: command.ordinal,
        text: command.text,
      }),
    ]
  })

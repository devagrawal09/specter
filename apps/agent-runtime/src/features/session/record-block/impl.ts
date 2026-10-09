import { NonNegativeInt } from '@ocpp/schema/schema'
import { SessionID } from '@ocpp/schema/session-id'
import { SessionMessage } from '@ocpp/schema/session-message'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: active executions, the in-flight step per Session
// and the blocks recorded in its current attempt, as kind:ordinal keys.
// Duplicated from the other step Slices on purpose.
export type RecordBlockState = {
  active: Record<string, true>
  inFlight: Record<string, { assistantMessageID: string; blocks: string[] }>
}

export const recordBlockStore = Context.Service<
  SliceStoreService<RecordBlockState, RecordBlockState, unknown>
>('@specter/agent-runtime/RecordBlockStore')

export const createRecordBlockState = (): RecordBlockState => ({
  active: {},
  inFlight: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')
const stepStarted = sessionEvent('session-step-started')
const stepSettled = sessionEvent('session-step-settled')
const blockRecorded = sessionEvent('session-block-recorded')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: SessionID,
    assistantMessageID: SessionMessage.ID,
    kind: Schema.Literals(['text', 'reasoning']),
    ordinal: NonNegativeInt,
    text: Schema.String,
    // Provider continuation state, recorded as given.
    state: Schema.optional(SessionMessage.ProviderState),
  }),
)

const key = (block: { kind: string; ordinal: number }) =>
  `${block.kind}:${block.ordinal}`

const settle = (state: RecordBlockState, sessionID: string) => {
  delete state.active[sessionID]
  delete state.inFlight[sessionID]
}

const closeStep = (
  state: RecordBlockState,
  sessionID: string,
  assistantMessageID: string,
) => {
  if (state.inFlight[sessionID]?.assistantMessageID === assistantMessageID)
    delete state.inFlight[sessionID]
}

export const recordBlock = implementCommand(specification)
  .inputSchema(input)
  .store(recordBlockStore)
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSettled, async (event, state) => {
    settle(state, event.payload.sessionID)
  })
  // Every step.started opens a physical attempt with fresh ordinals.
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    state.inFlight[sessionID] = { assistantMessageID, blocks: [] }
  })
  .apply(stepSettled, async (event, state) => {
    closeStep(state, event.payload.sessionID, event.payload.assistantMessageID)
  })
  .apply(blockRecorded, async (event, state) => {
    const step = state.inFlight[event.payload.sessionID]
    if (step?.assistantMessageID === event.payload.assistantMessageID)
      step.blocks.push(key(event.payload))
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    const step = state.inFlight[command.sessionID]
    if (step?.assistantMessageID !== command.assistantMessageID)
      throw new Error('Step not in flight')
    if (step.blocks.includes(key(command)))
      throw new Error('Block already recorded')
    return [
      blockRecorded.create({
        sessionID: command.sessionID,
        assistantMessageID: command.assistantMessageID,
        kind: command.kind,
        ordinal: command.ordinal,
        text: command.text,
        ...(command.state === undefined ? {} : { state: command.state }),
      }),
    ]
  })

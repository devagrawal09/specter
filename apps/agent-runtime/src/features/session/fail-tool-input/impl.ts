import { SessionError } from '@ocpp/schema/session-error'
import { SessionID } from '@ocpp/schema/session-id'
import { SessionMessage } from '@ocpp/schema/session-message'
import { Tool } from '@ocpp/schema/tool'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: active executions, the in-flight step per Session
// and the call ids its current attempt recorded, requested or failed.
// Duplicated on purpose.
export type FailToolInputState = {
  active: Record<string, true>
  inFlight: Record<string, { assistantMessageID: string; calls: string[] }>
}

export const failToolInputStore = Context.Service<
  SliceStoreService<FailToolInputState, FailToolInputState, unknown>
>('@specter/agent-runtime/FailToolInputStore')

export const createFailToolInputState = (): FailToolInputState => ({
  active: {},
  inFlight: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')
const stepStarted = sessionEvent('session-step-started')
const stepSettled = sessionEvent('session-step-settled')
const toolRequested = sessionEvent('session-tool-requested')
const toolInputFailed = sessionEvent('session-tool-input-failed')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: SessionID,
    assistantMessageID: SessionMessage.ID,
    id: Schema.String,
    name: Schema.String,
    // The raw input the model streamed, when it finished streaming.
    text: Schema.optional(Schema.String),
    error: SessionError.Error,
    executed: Schema.optional(Schema.Boolean),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
    content: Schema.optional(Schema.NonEmptyArray(Tool.Content)),
  }),
)

const record = (
  state: FailToolInputState,
  payload: { sessionID: string; assistantMessageID: string; id: string },
) => {
  const step = state.inFlight[payload.sessionID]
  if (step?.assistantMessageID === payload.assistantMessageID)
    step.calls.push(payload.id)
}

export const failToolInput = implementCommand(specification)
  .inputSchema(input)
  .store(failToolInputStore)
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSettled, async (event, state) => {
    delete state.active[event.payload.sessionID]
    delete state.inFlight[event.payload.sessionID]
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    state.inFlight[sessionID] = { assistantMessageID, calls: [] }
  })
  .apply(stepSettled, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    if (state.inFlight[sessionID]?.assistantMessageID === assistantMessageID)
      delete state.inFlight[sessionID]
  })
  .apply(toolRequested, async (event, state) => {
    record(state, event.payload)
  })
  .apply(toolInputFailed, async (event, state) => {
    record(state, event.payload)
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    const step = state.inFlight[command.sessionID]
    if (step?.assistantMessageID !== command.assistantMessageID)
      throw new Error('Step not in flight')
    if (step.calls.includes(command.id))
      throw new Error('Tool call already recorded')
    return [
      toolInputFailed.create({
        sessionID: command.sessionID,
        assistantMessageID: command.assistantMessageID,
        id: command.id,
        name: command.name,
        error: command.error,
        executed: command.executed ?? false,
        ...(command.text === undefined ? {} : { text: command.text }),
        ...(command.metadata === undefined
          ? {}
          : { metadata: command.metadata }),
        ...(command.content === undefined ? {} : { content: command.content }),
      }),
    ]
  })

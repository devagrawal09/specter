import { SessionError } from '@ocpp/schema/session-error'
import { SessionID } from '@ocpp/schema/session-id'
import { SessionMessage } from '@ocpp/schema/session-message'
import { Tool } from '@ocpp/schema/tool'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: active executions, the in-flight step per Session
// and its recorded calls with whether each has settled. Duplicated on purpose.
export type SettleToolCallState = {
  active: Record<string, true>
  inFlight: Record<
    string,
    { assistantMessageID: string; calls: Record<string, { settled: boolean }> }
  >
}

export const settleToolCallStore = Context.Service<
  SliceStoreService<SettleToolCallState, SettleToolCallState, unknown>
>('@specter/agent-runtime/SettleToolCallStore')

export const createSettleToolCallState = (): SettleToolCallState => ({
  active: {},
  inFlight: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')
const stepStarted = sessionEvent('session-step-started')
const stepSettled = sessionEvent('session-step-settled')
const toolRequested = sessionEvent('session-tool-requested')
const toolSettled = sessionEvent('session-tool-settled')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: SessionID,
    assistantMessageID: SessionMessage.ID,
    id: Schema.String,
    // Whether execution had begun (the schema's own flag; false by default).
    executed: Schema.optional(Schema.Boolean),
    // An error settles the call as failed; otherwise content settles it as
    // success.
    error: Schema.optional(SessionError.Error),
    content: Schema.optional(Schema.NonEmptyArray(Tool.Content)),
  }),
)

const settle = (state: SettleToolCallState, sessionID: string) => {
  delete state.active[sessionID]
  delete state.inFlight[sessionID]
}

const closeStep = (
  state: SettleToolCallState,
  sessionID: string,
  assistantMessageID: string,
) => {
  if (state.inFlight[sessionID]?.assistantMessageID === assistantMessageID)
    delete state.inFlight[sessionID]
}

const settleCall = (
  state: SettleToolCallState,
  payload: { sessionID: string; assistantMessageID: string; id: string },
) => {
  const call = state.inFlight[payload.sessionID]?.calls[payload.id]
  if (
    call &&
    state.inFlight[payload.sessionID]?.assistantMessageID ===
      payload.assistantMessageID
  )
    call.settled = true
}

export const settleToolCall = implementCommand(specification)
  .inputSchema(input)
  .store(settleToolCallStore)
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSettled, async (event, state) => {
    settle(state, event.payload.sessionID)
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    state.inFlight[sessionID] = { assistantMessageID, calls: {} }
  })
  .apply(stepSettled, async (event, state) => {
    closeStep(state, event.payload.sessionID, event.payload.assistantMessageID)
  })
  .apply(toolRequested, async (event, state) => {
    const { sessionID, assistantMessageID, id } = event.payload
    const step = state.inFlight[sessionID]
    if (step?.assistantMessageID === assistantMessageID)
      step.calls[id] = { settled: false }
  })
  .apply(toolSettled, async (event, state) => {
    settleCall(state, event.payload)
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    const step = state.inFlight[command.sessionID]
    if (step?.assistantMessageID !== command.assistantMessageID)
      throw new Error('Step not in flight')
    const call = step.calls[command.id]
    if (!call) throw new Error('Tool call not recorded')
    if (call.settled) throw new Error('Tool call already settled')
    const base = {
      sessionID: command.sessionID,
      assistantMessageID: command.assistantMessageID,
      id: command.id,
      executed: command.executed ?? false,
    }
    if (command.error)
      return [
        toolSettled.create({
          ...base,
          outcome: 'failed',
          error: command.error,
          ...(command.content ? { content: command.content } : {}),
        }),
      ]
    if (!command.content) throw new Error('Success needs content')
    return [
      toolSettled.create({
        ...base,
        outcome: 'succeeded',
        content: command.content,
      }),
    ]
  })

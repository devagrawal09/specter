import { SessionID } from '@ocpp/schema/session-id'
import type { SessionMessage } from '@ocpp/schema/session-message'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: known Sessions and whether each has an active
// execution (started, not yet succeeded/failed/interrupted). Duplicated from
// the other execution slices on purpose.
export type InterruptExecutionState = {
  sessions: Record<string, true>
  active: Record<string, true>
  // Calls of the in-flight attempt with tool-called and no result yet, in call
  // order, per Session. The interrupt settles these in its own commit.
  openCalls: Record<string, OpenCall[]>
  // The call name is only on tool-input-started.
  callNames: Record<string, Record<string, string>>
}
type OpenCall = {
  assistantMessageID: SessionMessage.ID
  id: string
  name: string
  executed: boolean
}

export const interruptExecutionStore = Context.Service<
  SliceStoreService<InterruptExecutionState, InterruptExecutionState, unknown>
>('@specter/agent-runtime/InterruptExecutionStore')

export const createInterruptExecutionState = (): InterruptExecutionState => ({
  sessions: {},
  active: {},
  openCalls: {},
  callNames: {},
})

const sessionCreated = sessionEvent('session-created')
const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')
const stepStarted = sessionEvent('session-step-started')
const toolInputStarted = sessionEvent('session-tool-input-started')
const toolCalled = sessionEvent('session-tool-called')
const toolSuccess = sessionEvent('session-tool-success')
const toolFailed = sessionEvent('session-tool-failed')

const clearCalls = (state: InterruptExecutionState, sessionID: string) => {
  delete state.openCalls[sessionID]
  delete state.callNames[sessionID]
}

const closeCall = (
  state: InterruptExecutionState,
  payload: { sessionID: string; assistantMessageID: string; id: string },
) => {
  const open = state.openCalls[payload.sessionID]
  if (open)
    state.openCalls[payload.sessionID] = open.filter(
      (call) =>
        call.assistantMessageID !== payload.assistantMessageID ||
        call.id !== payload.id,
    )
}

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: SessionID,
    reason: Schema.optional(
      Schema.Literals(['user', 'shutdown', 'superseded']),
    ),
  }),
)

// Interrupt appends the interrupted fact, preceded in the same commit by an
// aborted tool-failed for every open call (session.md: settling orphaned tool
// calls); pending inbox items are owned by the inbox slices and are never
// touched here.
export const interruptExecution = implementCommand(specification)
  .inputSchema(input)
  .store(interruptExecutionStore)
  .apply(sessionCreated, async (event, state) => {
    state.sessions[event.payload.sessionID] = true
  })
  // Deliberately a no-op: the pending-input scenario puts an enqueued item in
  // Given, and conformance requires an apply handler for every Given event.
  // Interrupt never reads or changes inbox state.
  .apply(inboxEnqueued, async () => undefined)
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSettled, async (event, state) => {
    delete state.active[event.payload.sessionID]
    clearCalls(state, event.payload.sessionID)
  })
  .apply(stepStarted, async (event, state) => {
    // A new attempt starts with a clean call table.
    clearCalls(state, event.payload.sessionID)
  })
  .apply(toolInputStarted, async (event, state) => {
    const { sessionID, id, name } = event.payload
    const names = state.callNames[sessionID] ?? {}
    names[id] = name
    state.callNames[sessionID] = names
  })
  .apply(toolCalled, async (event, state) => {
    const { sessionID, assistantMessageID, id, executed } = event.payload
    const name = state.callNames[sessionID]?.[id]
    if (name === undefined) return
    const open = state.openCalls[sessionID] ?? []
    open.push({ assistantMessageID, id, name, executed })
    state.openCalls[sessionID] = open
  })
  .apply(toolSuccess, async (event, state) => {
    closeCall(state, event.payload)
  })
  .apply(toolFailed, async (event, state) => {
    closeCall(state, event.payload)
  })
  .handle(async (command, state) => {
    if (!state.sessions[command.sessionID]) throw new Error('Session not found')
    // OC++: idle/settled interrupt is a public no-op; the M4 facade
    // translates this rejection back into success.
    if (!state.active[command.sessionID]) throw new Error('Session is idle')
    const aborted = (state.openCalls[command.sessionID] ?? []).map((call) =>
      toolFailed.create({
        sessionID: command.sessionID,
        assistantMessageID: call.assistantMessageID,
        id: call.id,
        error: {
          type: 'aborted',
          message: `Tool execution interrupted: ${call.name}`,
        },
        executed: call.executed,
      }),
    )
    return [
      ...aborted,
      executionSettled.create({
        sessionID: command.sessionID,
        outcome: 'interrupted',
        reason: command.reason ?? 'user',
      }),
    ]
  })

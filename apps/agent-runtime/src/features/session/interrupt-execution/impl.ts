import { SessionID } from '@ocpp/schema/session-id'
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
}

export const interruptExecutionStore = Context.Service<
  SliceStoreService<InterruptExecutionState, InterruptExecutionState, unknown>
>('@specter/agent-runtime/InterruptExecutionStore')

export const createInterruptExecutionState = (): InterruptExecutionState => ({
  sessions: {},
  active: {},
})

const sessionCreated = sessionEvent('session-created')
const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const executionStarted = sessionEvent('session-execution-started')
const executionSucceeded = sessionEvent('session-execution-succeeded')
const executionFailed = sessionEvent('session-execution-failed')
const executionInterrupted = sessionEvent('session-execution-interrupted')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: SessionID,
    reason: Schema.optional(
      Schema.Literals(['user', 'shutdown', 'superseded']),
    ),
  }),
)

// Interrupt only appends the interrupted fact; pending inbox items are owned
// by the inbox slices and are never touched here.
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
  .apply(executionSucceeded, async (event, state) => {
    delete state.active[event.payload.sessionID]
  })
  .apply(executionFailed, async (event, state) => {
    delete state.active[event.payload.sessionID]
  })
  .apply(executionInterrupted, async (event, state) => {
    delete state.active[event.payload.sessionID]
  })
  .handle(async (command, state) => {
    if (!state.sessions[command.sessionID]) throw new Error('Session not found')
    // OC++: idle/settled interrupt is a public no-op; the M4 facade
    // translates this rejection back into success.
    if (!state.active[command.sessionID]) throw new Error('Session is idle')
    return [
      executionInterrupted.create({
        sessionID: command.sessionID,
        reason: command.reason ?? 'user',
      }),
    ]
  })

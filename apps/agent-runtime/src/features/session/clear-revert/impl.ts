import { SessionID } from '@ocpp/schema/session-id'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: known Sessions, the staged boundary per Session and
// whether an execution is active. Duplicated from the other revert slices on
// purpose.
export type ClearRevertState = {
  sessions: Record<string, true>
  staged: Record<string, string>
  active: Record<string, true>
}

export const clearRevertStore = Context.Service<
  SliceStoreService<ClearRevertState, ClearRevertState, unknown>
>('@specter/agent-runtime/ClearRevertStore')

export const createClearRevertState = (): ClearRevertState => ({
  sessions: {},
  staged: {},
  active: {},
})

const sessionCreated = sessionEvent('session-created')
const executionStarted = sessionEvent('session-execution-started')
const executionSucceeded = sessionEvent('session-execution-succeeded')
const executionFailed = sessionEvent('session-execution-failed')
const executionInterrupted = sessionEvent('session-execution-interrupted')
const revertStaged = sessionEvent('session-revert-staged')
const revertCleared = sessionEvent('session-revert-cleared')
const revertCommitted = sessionEvent('session-revert-committed')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

export const clearRevert = implementCommand(specification)
  .inputSchema(input)
  .store(clearRevertStore)
  .apply(sessionCreated, async (event, state) => {
    state.sessions[event.payload.sessionID] = true
  })
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
  .apply(revertStaged, async (event, state) => {
    state.staged[event.payload.sessionID] = event.payload.revert.messageID
  })
  .apply(revertCleared, async (event, state) => {
    delete state.staged[event.payload.sessionID]
  })
  .apply(revertCommitted, async (event, state) => {
    delete state.staged[event.payload.sessionID]
  })
  .handle(async (command, state) => {
    if (!state.sessions[command.sessionID]) throw new Error('Session not found')
    if (state.active[command.sessionID]) throw new Error('Session is busy')
    if (state.staged[command.sessionID] === undefined)
      throw new Error('No revert staged')
    return [revertCleared.create({ sessionID: command.sessionID })]
  })

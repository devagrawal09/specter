import { SessionID } from '@ocpp/schema/session-id'
import type { SessionMessage } from '@ocpp/schema/session-message'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: known Sessions, the staged boundary per Session and
// whether an execution is active. Duplicated from the other revert slices on
// purpose.
export type CommitRevertState = {
  sessions: Record<string, true>
  staged: Record<string, SessionMessage.ID>
  active: Record<string, true>
}

export const commitRevertStore = Context.Service<
  SliceStoreService<CommitRevertState, CommitRevertState, unknown>
>('@specter/agent-runtime/CommitRevertStore')

export const createCommitRevertState = (): CommitRevertState => ({
  sessions: {},
  staged: {},
  active: {},
})

const sessionCreated = sessionEvent('session-created')
const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')
const revertStaged = sessionEvent('session-revert-staged')
const revertCleared = sessionEvent('session-revert-cleared')
const revertCommitted = sessionEvent('session-revert-committed')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

export const commitRevert = implementCommand(specification)
  .inputSchema(input)
  .store(commitRevertStore)
  .apply(sessionCreated, async (event, state) => {
    state.sessions[event.payload.sessionID] = true
  })
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSettled, async (event, state) => {
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
    const boundary = state.staged[command.sessionID]
    if (boundary === undefined) throw new Error('No revert staged')
    return [
      revertCommitted.create({ sessionID: command.sessionID, to: boundary }),
    ]
  })

import { SessionID } from '@ocpp/schema/session-id'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: known Sessions and whether each has an active
// execution (started, not yet succeeded/failed/interrupted). Duplicated from
// the other execution slices on purpose.
export type StartExecutionState = {
  sessions: Record<string, true>
  active: Record<string, true>
}

export const startExecutionStore = Context.Service<
  SliceStoreService<StartExecutionState, StartExecutionState, unknown>
>('@specter/agent-runtime/StartExecutionStore')

export const createStartExecutionState = (): StartExecutionState => ({
  sessions: {},
  active: {},
})

const sessionCreated = sessionEvent('session-created')
const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

export const startExecution = implementCommand(specification)
  .inputSchema(input)
  .store(startExecutionStore)
  .apply(sessionCreated, async (event, state) => {
    state.sessions[event.payload.sessionID] = true
  })
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSettled, async (event, state) => {
    delete state.active[event.payload.sessionID]
  })
  .handle(async (command, state) => {
    if (!state.sessions[command.sessionID]) throw new Error('Session not found')
    if (state.active[command.sessionID])
      throw new Error('Execution already active')
    return [executionStarted.create({ sessionID: command.sessionID })]
  })

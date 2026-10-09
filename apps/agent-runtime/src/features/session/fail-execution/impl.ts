import { SessionError } from '@ocpp/schema/session-error'
import { SessionID } from '@ocpp/schema/session-id'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: active executions. Duplicated on purpose.
export type FailExecutionState = { active: Record<string, true> }

export const failExecutionStore = Context.Service<
  SliceStoreService<FailExecutionState, FailExecutionState, unknown>
>('@specter/agent-runtime/FailExecutionStore')

export const createFailExecutionState = (): FailExecutionState => ({
  active: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({ sessionID: SessionID, error: SessionError.Error }),
)

// Fails the busy period for a reason outside a step (a manual or automatic
// compaction that failed). A step's own failure is settleStep's.
export const failExecution = implementCommand(specification)
  .inputSchema(input)
  .store(failExecutionStore)
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSettled, async (event, state) => {
    delete state.active[event.payload.sessionID]
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    return [
      executionSettled.create({
        sessionID: command.sessionID,
        outcome: 'failed',
        error: command.error,
      }),
    ]
  })

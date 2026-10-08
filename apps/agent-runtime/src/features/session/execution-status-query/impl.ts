import { implementQuery, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection folded from execution events, keyed by Session.
type Outcome = 'succeeded' | 'failed' | 'interrupted'
type Execution = {
  active: boolean
  executions: number
  lastOutcome: Outcome | null
}

export type ExecutionStatusState = { sessions: Record<string, Execution> }

export const executionStatusStore = Context.Service<
  SliceStoreService<ExecutionStatusState, ExecutionStatusState, unknown>
>('@specter/agent-runtime/ExecutionStatusStore')

export const createExecutionStatusState = (): ExecutionStatusState => ({
  sessions: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSucceeded = sessionEvent('session-execution-succeeded')
const executionFailed = sessionEvent('session-execution-failed')
const executionInterrupted = sessionEvent('session-execution-interrupted')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({ sessionID: Schema.String }),
)

type SessionRef = { sessionID: string }

const entry = (state: ExecutionStatusState, sessionID: string) =>
  (state.sessions[sessionID] ??= {
    active: false,
    executions: 0,
    lastOutcome: null,
  })

const end = (
  state: ExecutionStatusState,
  sessionID: string,
  outcome: Outcome,
) => {
  const session = entry(state, sessionID)
  session.active = false
  session.lastOutcome = outcome
}

export const executionStatus = implementQuery(specification)
  .inputSchema(input)
  .outputSchema<{
    status: 'idle' | 'active' | 'settled'
    executions: number
    lastOutcome: Outcome | null
  }>()
  .store(executionStatusStore)
  .apply(executionStarted, async (event, state) => {
    const session = entry(state, (event.payload as SessionRef).sessionID)
    session.active = true
    session.executions += 1
  })
  .apply(executionSucceeded, async (event, state) => {
    end(state, (event.payload as SessionRef).sessionID, 'succeeded')
  })
  .apply(executionFailed, async (event, state) => {
    end(state, (event.payload as SessionRef).sessionID, 'failed')
  })
  .apply(executionInterrupted, async (event, state) => {
    end(state, (event.payload as SessionRef).sessionID, 'interrupted')
  })
  .handle(async (query, state) => {
    const session = state.sessions[query.sessionID]
    if (!session || session.executions === 0)
      return { status: 'idle' as const, executions: 0, lastOutcome: null }
    return {
      status: session.active ? ('active' as const) : ('settled' as const),
      executions: session.executions,
      lastOutcome: session.lastOutcome,
    }
  })

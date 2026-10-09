import type { SessionError } from '@ocpp/schema/session-error'
import { SessionID } from '@ocpp/schema/session-id'
import { implementQuery, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection folded from execution events, keyed by Session.
type Outcome = 'succeeded' | 'failed' | 'interrupted'
type Reason = 'user' | 'shutdown' | 'superseded'
type Execution = {
  active: boolean
  executions: number
  lastOutcome: Outcome | null
  // Why the last execution failed or was interrupted.
  error?: SessionError.Error
  reason?: Reason
}

export type ExecutionStatusState = { sessions: Record<string, Execution> }

export const executionStatusStore = Context.Service<
  SliceStoreService<ExecutionStatusState, ExecutionStatusState, unknown>
>('@specter/agent-runtime/ExecutionStatusStore')

export const createExecutionStatusState = (): ExecutionStatusState => ({
  sessions: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

const entry = (state: ExecutionStatusState, sessionID: string) =>
  (state.sessions[sessionID] ??= {
    active: false,
    executions: 0,
    lastOutcome: null,
  })

const end = (
  state: ExecutionStatusState,
  sessionID: string,
  settled: {
    readonly outcome: Outcome
    readonly error?: SessionError.Error
    readonly reason?: Reason
  },
) => {
  const session = entry(state, sessionID)
  session.active = false
  session.lastOutcome = settled.outcome
  delete session.error
  delete session.reason
  if (settled.error) session.error = settled.error
  if (settled.reason) session.reason = settled.reason
}

export const executionStatus = implementQuery(specification)
  .inputSchema(input)
  .outputSchema<{
    status: 'idle' | 'active' | 'settled'
    executions: number
    lastOutcome: Outcome | null
    error?: SessionError.Error
    reason?: Reason
  }>()
  .store(executionStatusStore)
  .apply(executionStarted, async (event, state) => {
    const session = entry(state, event.payload.sessionID)
    session.active = true
    session.executions += 1
  })
  .apply(executionSettled, async (event, state) => {
    end(state, event.payload.sessionID, event.payload)
  })
  .handle(async (query, state) => {
    const session = state.sessions[query.sessionID]
    if (!session || session.executions === 0)
      return { status: 'idle' as const, executions: 0, lastOutcome: null }
    return {
      status: session.active ? ('active' as const) : ('settled' as const),
      executions: session.executions,
      lastOutcome: session.lastOutcome,
      ...(session.error ? { error: session.error } : {}),
      ...(session.reason ? { reason: session.reason } : {}),
    }
  })

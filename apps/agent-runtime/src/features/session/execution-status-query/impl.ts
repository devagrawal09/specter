import type { SessionError } from '@ocpp/schema/session-error'
import { SessionDriver } from '@ocpp/schema/session-driver'
import { SessionID } from '@ocpp/schema/session-id'
import { implementQuery, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection folded from execution events, keyed by Session, with
// the input that will wake it (the wake Reaction's view, duplicated on
// purpose): a Session with such input is not idle yet.
type Outcome = 'succeeded' | 'failed' | 'interrupted'
type Reason = 'user' | 'shutdown' | 'superseded'
type Execution = {
  active: boolean
  executions: number
  lastOutcome: Outcome | null
  // Why the last execution failed or was interrupted.
  error?: SessionError.Error
  reason?: Reason
  // Pending input that wakes the Session; an external agent's Session is
  // never woken by this runtime.
  waking: Record<string, true>
  driven?: true
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
const sessionCreated = sessionEvent('session-created')
const modelSelected = sessionEvent('session-model-selected')
const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const inboxHeld = sessionEvent('session-inbox-held')
const inboxDelivered = sessionEvent('session-inbox-delivered')
const inboxCancelled = sessionEvent('session-inbox-cancelled')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

const entry = (state: ExecutionStatusState, sessionID: string) =>
  (state.sessions[sessionID] ??= {
    active: false,
    executions: 0,
    lastOutcome: null,
    waking: {},
  })

const drive = (
  state: ExecutionStatusState,
  sessionID: string,
  model: { readonly providerID: string } | undefined,
) => {
  const session = entry(state, sessionID)
  if (SessionDriver.of(model) === 'ocpp') delete session.driven
  else session.driven = true
}

const consumed = (
  state: ExecutionStatusState,
  payload: { readonly sessionID: string; readonly inboxID: string },
) => {
  delete entry(state, payload.sessionID).waking[payload.inboxID]
}

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
  // An interruption never wakes the Session by itself.
  if (settled.outcome === 'interrupted') session.waking = {}
}

export const executionStatus = implementQuery(specification)
  .inputSchema(input)
  .outputSchema<{
    status: 'idle' | 'active' | 'settled'
    executions: number
    lastOutcome: Outcome | null
    error?: SessionError.Error
    reason?: Reason
    // Not active, but pending input will start the next execution: not idle
    // yet.
    wakes?: true
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
  .apply(sessionCreated, async (event, state) => {
    drive(state, event.payload.sessionID, event.payload.model)
  })
  .apply(modelSelected, async (event, state) => {
    drive(state, event.payload.sessionID, event.payload.model)
  })
  .apply(inboxEnqueued, async (event, state) => {
    entry(state, event.payload.sessionID).waking[event.payload.inboxID] = true
  })
  .apply(inboxHeld, async (event, state) => {
    consumed(state, event.payload)
  })
  .apply(inboxDelivered, async (event, state) => {
    consumed(state, event.payload)
  })
  .apply(inboxCancelled, async (event, state) => {
    consumed(state, event.payload)
  })
  .handle(async (query, state) => {
    const session = state.sessions[query.sessionID]
    const wakes =
      session !== undefined &&
      !session.active &&
      !session.driven &&
      Object.keys(session.waking).length > 0
    if (!session || session.executions === 0)
      return {
        status: 'idle' as const,
        executions: 0,
        lastOutcome: null,
        ...(wakes ? { wakes: true as const } : {}),
      }
    return {
      status: session.active ? ('active' as const) : ('settled' as const),
      executions: session.executions,
      lastOutcome: session.lastOutcome,
      ...(session.error ? { error: session.error } : {}),
      ...(session.reason ? { reason: session.reason } : {}),
      ...(wakes ? { wakes: true as const } : {}),
    }
  })

import type { SessionError } from '@ocpp/schema/session-error'
import { SessionID } from '@ocpp/schema/session-id'
import { implementQuery, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection, per Session: its executions, the input that will
// wake it (the wake Reaction's view, duplicated on purpose), its steps, and
// what its next step starts from (OC++ runner). One fold, so a reader at a
// step boundary sees all of it as of one commit.
type Outcome = 'succeeded' | 'failed' | 'interrupted'
type Reason = 'user' | 'shutdown' | 'superseded'
type OpenCall = {
  assistantMessageID: string
  id: string
  name: string
  executed: boolean
}
type Entry = {
  active: boolean
  executions: number
  lastOutcome: Outcome | null
  // Why the last execution failed or was interrupted.
  error?: SessionError.Error
  reason?: Reason
  // Pending input that wakes the Session.
  waking: Record<string, true>
  // The step in flight, by assistant message ID.
  inFlight: string | null
  stepsStarted: number
  // Physical attempts of the latest step; a retried step is the same step.
  attempts: number
  retrying: boolean
  lastFailure?: SessionError.Error
  // Requested calls of the in-flight attempt that have not settled.
  openCalls: OpenCall[]
  // The execution rests between steps: queued input may enter.
  idle: boolean
  // The execution continues an interrupted turn: it never takes queued input.
  continued?: true
  stepsInExecution: number
  stepsSinceInput: number
  retryAt?: number
  // The attempt the next step is of its logical step, after a retry.
  attempt?: number
}

export type SessionStatusState = {
  sessions: Record<string, Entry>
  // Input items (user, synthetic) by inbox ID: delivering one resets the
  // step-limit counter, a control item does not.
  inputs: Record<string, true>
}

export const sessionStatusStore = Context.Service<
  SliceStoreService<SessionStatusState, SessionStatusState, unknown>
>('@specter/agent-runtime/SessionStatusStore')

export const createSessionStatusState = (): SessionStatusState => ({
  sessions: {},
  inputs: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionContinued = sessionEvent('session-execution-continued')
const executionSettled = sessionEvent('session-execution-settled')
const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const inboxHeld = sessionEvent('session-inbox-held')
const inboxDelivered = sessionEvent('session-inbox-delivered')
const inboxCancelled = sessionEvent('session-inbox-cancelled')
const stepStarted = sessionEvent('session-step-started')
const stepSettled = sessionEvent('session-step-settled')
const toolRequested = sessionEvent('session-tool-requested')
const toolSettled = sessionEvent('session-tool-settled')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

const entry = (state: SessionStatusState, sessionID: string): Entry =>
  (state.sessions[sessionID] ??= {
    active: false,
    executions: 0,
    lastOutcome: null,
    waking: {},
    inFlight: null,
    stepsStarted: 0,
    attempts: 0,
    retrying: false,
    openCalls: [],
    idle: true,
    stepsInExecution: 0,
    stepsSinceInput: 0,
  })

const consumed = (
  state: SessionStatusState,
  payload: { readonly sessionID: string; readonly inboxID: string },
) => {
  delete entry(state, payload.sessionID).waking[payload.inboxID]
}

export const sessionStatus = implementQuery(specification)
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
    step: {
      // The assistant message ID of the step in flight: what orphan
      // reconciliation fails.
      inFlight?: string
      // Steps started across the Session's executions; a retried step is
      // the same step.
      started: number
      // Physical attempts of the latest step.
      attempts: number
      // The next attempt runs the last step again.
      retrying?: true
      lastFailure?: SessionError.Error
      // Requested calls that have not settled, in call order; omitted when
      // none. What orphan reconciliation settles as aborted.
      openCalls?: OpenCall[]
    }
    next: {
      // Which inbox items the next step delivers first (nextDeliverable's
      // boundary): idle admits a queued item, step only steers, and entry (the
      // rest points of an execution continuing an interrupted turn) admits a
      // queued control item but no queued input.
      boundary: 'idle' | 'step' | 'entry'
      stepsInExecution: number
      // Steps run since input was last delivered: the next step is one more.
      stepsSinceInput: number
      // When the step being retried is due (epoch milliseconds).
      retryAt?: number
      // Which attempt of its logical step the next step is, from 1: retries,
      // fresh ones included, share the step's number and budget.
      attempt: number
    }
  }>()
  .store(sessionStatusStore)
  // A new execution starts idle with no steps of its own.
  .apply(executionStarted, async (event, state) => {
    const session = entry(state, event.payload.sessionID)
    session.active = true
    session.executions += 1
    // The execution takes the wakes recorded before it started.
    session.waking = {}
    session.idle = true
    delete session.continued
    session.stepsInExecution = 0
    session.stepsSinceInput = 0
    delete session.retryAt
    delete session.attempt
  })
  .apply(executionContinued, async (event, state) => {
    entry(state, event.payload.sessionID).continued = true
  })
  .apply(executionSettled, async (event, state) => {
    const session = entry(state, event.payload.sessionID)
    const settled = event.payload
    session.active = false
    session.lastOutcome = settled.outcome
    delete session.error
    delete session.reason
    if (settled.outcome === 'failed') session.error = settled.error
    if (settled.outcome === 'interrupted') {
      session.reason = settled.reason
      // An interruption never wakes the Session by itself.
      session.waking = {}
    }
    // An execution ending abandons its in-flight step.
    session.inFlight = null
    session.retrying = false
    session.openCalls = []
    delete session.lastFailure
  })
  .apply(inboxEnqueued, async (event, state) => {
    const { sessionID, inboxID, item } = event.payload
    entry(state, sessionID).waking[inboxID] = true
    if (item.type === 'user' || item.type === 'synthetic')
      state.inputs[inboxID] = true
  })
  .apply(inboxHeld, async (event, state) => {
    consumed(state, event.payload)
  })
  .apply(inboxDelivered, async (event, state) => {
    consumed(state, event.payload)
    if (state.inputs[event.payload.inboxID])
      entry(state, event.payload.sessionID).stepsSinceInput = 0
  })
  .apply(inboxCancelled, async (event, state) => {
    consumed(state, event.payload)
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    const session = entry(state, sessionID)
    session.inFlight = assistantMessageID
    // A step started after a scheduled retry is another attempt of the same step.
    if (session.retrying) session.attempts += 1
    else {
      session.stepsStarted += 1
      session.attempts = 1
    }
    session.retrying = false
    // A new attempt starts with a clean call table.
    session.openCalls = []
    delete session.lastFailure
    session.idle = false
    session.stepsInExecution += 1
    // A retried step keeps its number.
    if (session.retryAt === undefined) session.stepsSinceInput += 1
    delete session.retryAt
  })
  .apply(toolRequested, async (event, state) => {
    const { sessionID, assistantMessageID, id, name, executed } = event.payload
    const session = entry(state, sessionID)
    if (session.inFlight === assistantMessageID)
      session.openCalls.push({ assistantMessageID, id, name, executed })
  })
  .apply(toolSettled, async (event, state) => {
    const { sessionID, assistantMessageID, id } = event.payload
    const session = entry(state, sessionID)
    session.openCalls = session.openCalls.filter(
      (call) =>
        call.assistantMessageID !== assistantMessageID || call.id !== id,
    )
  })
  .apply(stepSettled, async (event, state) => {
    const { payload } = event
    const session = entry(state, payload.sessionID)
    if (session.inFlight === payload.assistantMessageID) session.inFlight = null
    session.idle = payload.outcome === 'succeeded' && payload.continues !== true
    delete session.attempt
    if (payload.outcome !== 'failed') return
    session.lastFailure = payload.error
    if (!payload.retry) return
    session.retryAt = payload.retry.at
    session.attempt = payload.retry.attempt + 1
    // A fresh retry runs as the next step.
    if (!payload.retry.fresh) session.retrying = true
  })
  .handle(async (query, state) => {
    const session =
      state.sessions[query.sessionID] ??
      entry({ sessions: {}, inputs: {} }, query.sessionID)
    const wakes = !session.active && Object.keys(session.waking).length > 0
    return {
      status: session.active
        ? ('active' as const)
        : session.executions === 0
          ? ('idle' as const)
          : ('settled' as const),
      executions: session.executions,
      lastOutcome: session.lastOutcome,
      ...(session.error ? { error: session.error } : {}),
      ...(session.reason ? { reason: session.reason } : {}),
      ...(wakes ? { wakes: true as const } : {}),
      step: {
        ...(session.inFlight === null ? {} : { inFlight: session.inFlight }),
        started: session.stepsStarted,
        attempts: session.attempts,
        ...(session.retrying ? { retrying: true as const } : {}),
        ...(session.lastFailure === undefined
          ? {}
          : { lastFailure: session.lastFailure }),
        ...(session.openCalls.length === 0
          ? {}
          : { openCalls: session.openCalls }),
      },
      next: {
        boundary: !session.idle
          ? ('step' as const)
          : session.continued
            ? ('entry' as const)
            : ('idle' as const),
        stepsInExecution: session.stepsInExecution,
        stepsSinceInput: session.stepsSinceInput,
        ...(session.retryAt === undefined ? {} : { retryAt: session.retryAt }),
        attempt: session.attempt ?? 1,
      },
    }
  })

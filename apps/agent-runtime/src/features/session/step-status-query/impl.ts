import { SessionID } from '@ocpp/schema/session-id'
import { implementQuery, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection folded from execution and step events, keyed by
// Session. Duplicated from run-step-reaction on purpose.
type Failure = { type: string; message: string; status?: number }
type Entry = {
  active: boolean
  inFlight: string | null
  stepsStarted: number
  // Physical attempts of the latest step; a retried step is the same step.
  attempts: number
  retrying: boolean
  lastFailure?: Failure
}

export type StepStatusState = { sessions: Record<string, Entry> }

export const stepStatusStore = Context.Service<
  SliceStoreService<StepStatusState, StepStatusState, unknown>
>('@specter/agent-runtime/StepStatusStore')

export const createStepStatusState = (): StepStatusState => ({ sessions: {} })

const executionStarted = sessionEvent('session-execution-started')
const executionSucceeded = sessionEvent('session-execution-succeeded')
const executionFailed = sessionEvent('session-execution-failed')
const executionInterrupted = sessionEvent('session-execution-interrupted')
const stepStarted = sessionEvent('session-step-started')
const stepEnded = sessionEvent('session-step-ended')
const stepFailed = sessionEvent('session-step-failed')
const retryScheduled = sessionEvent('session-retry-scheduled')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

const entry = (state: StepStatusState, sessionID: string) =>
  (state.sessions[sessionID] ??= {
    active: false,
    inFlight: null,
    stepsStarted: 0,
    attempts: 0,
    retrying: false,
  })

const settle = (state: StepStatusState, sessionID: string) => {
  const session = entry(state, sessionID)
  session.active = false
  session.inFlight = null
  session.retrying = false
  delete session.lastFailure
}

export const stepStatus = implementQuery(specification)
  .inputSchema(input)
  .outputSchema<{
    active: boolean
    stepInFlight: boolean
    stepsStarted: number
    attempts: number
    lastFailure?: { type: string; message: string; status?: number }
  }>()
  .store(stepStatusStore)
  .apply(executionStarted, async (event, state) => {
    entry(state, event.payload.sessionID).active = true
  })
  .apply(executionSucceeded, async (event, state) => {
    settle(state, event.payload.sessionID)
  })
  .apply(executionFailed, async (event, state) => {
    settle(state, event.payload.sessionID)
  })
  .apply(executionInterrupted, async (event, state) => {
    settle(state, event.payload.sessionID)
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
    delete session.lastFailure
  })
  .apply(stepEnded, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    const session = entry(state, sessionID)
    if (session.inFlight === assistantMessageID) session.inFlight = null
  })
  .apply(stepFailed, async (event, state) => {
    const { sessionID, assistantMessageID, error } = event.payload
    const session = entry(state, sessionID)
    if (session.inFlight === assistantMessageID) session.inFlight = null
    session.lastFailure = error
  })
  .apply(retryScheduled, async (event, state) => {
    entry(state, event.payload.sessionID).retrying = true
  })
  .handle(async (query, state) => {
    const session = state.sessions[query.sessionID]
    return {
      active: session?.active ?? false,
      stepInFlight: session?.inFlight != null,
      stepsStarted: session?.stepsStarted ?? 0,
      attempts: session?.attempts ?? 0,
      ...(session?.lastFailure === undefined
        ? {}
        : { lastFailure: session.lastFailure }),
    }
  })

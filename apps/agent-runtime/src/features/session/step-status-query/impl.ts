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
  // Requested calls of the in-flight attempt that have not settled.
  openCalls: OpenCall[]
}
type OpenCall = {
  assistantMessageID: string
  id: string
  name: string
  executed: boolean
}

export type StepStatusState = { sessions: Record<string, Entry> }

export const stepStatusStore = Context.Service<
  SliceStoreService<StepStatusState, StepStatusState, unknown>
>('@specter/agent-runtime/StepStatusStore')

export const createStepStatusState = (): StepStatusState => ({ sessions: {} })

const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')
const stepStarted = sessionEvent('session-step-started')
const stepSettled = sessionEvent('session-step-settled')
const toolRequested = sessionEvent('session-tool-requested')
const toolSettled = sessionEvent('session-tool-settled')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

const entry = (state: StepStatusState, sessionID: string) =>
  (state.sessions[sessionID] ??= {
    active: false,
    inFlight: null,
    stepsStarted: 0,
    attempts: 0,
    retrying: false,
    openCalls: [],
  })

const settle = (state: StepStatusState, sessionID: string) => {
  const session = entry(state, sessionID)
  session.active = false
  session.inFlight = null
  session.retrying = false
  session.openCalls = []
  delete session.lastFailure
}

const closeCall = (
  session: Entry,
  payload: { assistantMessageID: string; id: string },
) => {
  session.openCalls = session.openCalls.filter(
    (call) =>
      call.assistantMessageID !== payload.assistantMessageID ||
      call.id !== payload.id,
  )
}

export const stepStatus = implementQuery(specification)
  .inputSchema(input)
  .outputSchema<{
    active: boolean
    stepInFlight: boolean
    // The assistant message ID of the step in flight: what orphan
    // reconciliation fails.
    inFlightStepID?: string
    stepsStarted: number
    attempts: number
    // The next attempt runs the last step again.
    retrying?: true
    lastFailure?: { type: string; message: string; status?: number }
    // Requested calls that have not settled, in call order; omitted when
    // none. What orphan reconciliation settles as aborted.
    openCalls?: {
      assistantMessageID: string
      id: string
      name: string
      executed: boolean
    }[]
  }>()
  .store(stepStatusStore)
  .apply(executionStarted, async (event, state) => {
    entry(state, event.payload.sessionID).active = true
  })
  .apply(executionSettled, async (event, state) => {
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
    // A new attempt starts with a clean call table.
    session.openCalls = []
    delete session.lastFailure
  })
  .apply(toolRequested, async (event, state) => {
    const { sessionID, assistantMessageID, id, name, executed } = event.payload
    const session = entry(state, sessionID)
    if (session.inFlight === assistantMessageID)
      session.openCalls.push({ assistantMessageID, id, name, executed })
  })
  .apply(toolSettled, async (event, state) => {
    closeCall(entry(state, event.payload.sessionID), event.payload)
  })
  .apply(stepSettled, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    const session = entry(state, sessionID)
    if (session.inFlight === assistantMessageID) session.inFlight = null
    if (event.payload.outcome !== 'failed') return
    session.lastFailure = event.payload.error
    // A fresh retry runs as the next step.
    if (event.payload.retry && !event.payload.retry.fresh)
      session.retrying = true
  })
  .handle(async (query, state) => {
    const session = state.sessions[query.sessionID]
    return {
      active: session?.active ?? false,
      stepInFlight: session?.inFlight != null,
      ...(session?.inFlight == null
        ? {}
        : { inFlightStepID: session.inFlight }),
      stepsStarted: session?.stepsStarted ?? 0,
      attempts: session?.attempts ?? 0,
      ...(session?.retrying ? { retrying: true as const } : {}),
      ...(session === undefined || session.openCalls.length === 0
        ? {}
        : { openCalls: session.openCalls }),
      ...(session?.lastFailure === undefined
        ? {}
        : { lastFailure: session.lastFailure }),
    }
  })

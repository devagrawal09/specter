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
  // Calls of the in-flight attempt recorded by tool-called and not yet settled.
  openCalls: OpenCall[]
  // The call name is only on tool-input-started; tool-called has the rest.
  callNames: Record<string, string>
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
const stepEnded = sessionEvent('session-step-ended')
const stepFailed = sessionEvent('session-step-failed')
const retryScheduled = sessionEvent('session-retry-scheduled')
const toolInputStarted = sessionEvent('session-tool-input-started')
const toolCalled = sessionEvent('session-tool-called')
const toolSuccess = sessionEvent('session-tool-success')
const toolFailed = sessionEvent('session-tool-failed')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

const entry = (state: StepStatusState, sessionID: string) =>
  (state.sessions[sessionID] ??= {
    active: false,
    inFlight: null,
    stepsStarted: 0,
    attempts: 0,
    retrying: false,
    openCalls: [],
    callNames: {},
  })

const settle = (state: StepStatusState, sessionID: string) => {
  const session = entry(state, sessionID)
  session.active = false
  session.inFlight = null
  session.retrying = false
  session.openCalls = []
  session.callNames = {}
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
    lastFailure?: { type: string; message: string; status?: number }
    // Calls with tool-called and no tool-success/tool-failed, in call order;
    // omitted when none. What orphan reconciliation settles as aborted.
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
    session.callNames = {}
    delete session.lastFailure
  })
  .apply(toolInputStarted, async (event, state) => {
    const { sessionID, id, name } = event.payload
    entry(state, sessionID).callNames[id] = name
  })
  .apply(toolCalled, async (event, state) => {
    const { sessionID, assistantMessageID, id, executed } = event.payload
    const session = entry(state, sessionID)
    const name = session.callNames[id]
    if (session.inFlight === assistantMessageID && name !== undefined)
      session.openCalls.push({ assistantMessageID, id, name, executed })
  })
  .apply(toolSuccess, async (event, state) => {
    closeCall(entry(state, event.payload.sessionID), event.payload)
  })
  .apply(toolFailed, async (event, state) => {
    closeCall(entry(state, event.payload.sessionID), event.payload)
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
      ...(session?.inFlight == null
        ? {}
        : { inFlightStepID: session.inFlight }),
      stepsStarted: session?.stepsStarted ?? 0,
      attempts: session?.attempts ?? 0,
      ...(session === undefined || session.openCalls.length === 0
        ? {}
        : { openCalls: session.openCalls }),
      ...(session?.lastFailure === undefined
        ? {}
        : { lastFailure: session.lastFailure }),
    }
  })

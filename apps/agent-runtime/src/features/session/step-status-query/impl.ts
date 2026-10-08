import { implementQuery, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection folded from execution and step events, keyed by
// Session. Duplicated from run-step-reaction on purpose.
type Entry = { active: boolean; inFlight: string | null; stepsStarted: number }

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

type SessionRef = { sessionID: string }
type StepRef = { sessionID: string; assistantMessageID: string }

const input = Schema.toStandardSchemaV1(
  Schema.Struct({ sessionID: Schema.String }),
)

const entry = (state: StepStatusState, sessionID: string) =>
  (state.sessions[sessionID] ??= {
    active: false,
    inFlight: null,
    stepsStarted: 0,
  })

const settle = (state: StepStatusState, sessionID: string) => {
  const session = entry(state, sessionID)
  session.active = false
  session.inFlight = null
}

export const stepStatus = implementQuery(specification)
  .inputSchema(input)
  .outputSchema<{
    active: boolean
    stepInFlight: boolean
    stepsStarted: number
  }>()
  .store(stepStatusStore)
  .apply(executionStarted, async (event, state) => {
    entry(state, (event.payload as SessionRef).sessionID).active = true
  })
  .apply(executionSucceeded, async (event, state) => {
    settle(state, (event.payload as SessionRef).sessionID)
  })
  .apply(executionFailed, async (event, state) => {
    settle(state, (event.payload as SessionRef).sessionID)
  })
  .apply(executionInterrupted, async (event, state) => {
    settle(state, (event.payload as SessionRef).sessionID)
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload as StepRef
    const session = entry(state, sessionID)
    session.inFlight = assistantMessageID
    session.stepsStarted += 1
  })
  .apply(stepEnded, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload as StepRef
    const session = entry(state, sessionID)
    if (session.inFlight === assistantMessageID) session.inFlight = null
  })
  .handle(async (query, state) => {
    const session = state.sessions[query.sessionID]
    return {
      active: session?.active ?? false,
      stepInFlight: session?.inFlight != null,
      stepsStarted: session?.stepsStarted ?? 0,
    }
  })

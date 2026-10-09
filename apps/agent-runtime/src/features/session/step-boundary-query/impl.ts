import { SessionID } from '@ocpp/schema/session-id'
import { implementQuery, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection, per Session: the boundary the next step starts at.
// An execution starts at an idle boundary; a step that continues (tool results
// to answer) is followed at a step boundary; any other settled step leaves the
// execution idle again. Duplicated on purpose.
type Entry = {
  idle: boolean
  stepsInExecution: number
}

export type StepBoundaryState = { sessions: Record<string, Entry> }

export const stepBoundaryStore = Context.Service<
  SliceStoreService<StepBoundaryState, StepBoundaryState, unknown>
>('@specter/agent-runtime/StepBoundaryStore')

export const createStepBoundaryState = (): StepBoundaryState => ({
  sessions: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')
const stepStarted = sessionEvent('session-step-started')
const stepSettled = sessionEvent('session-step-settled')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

const entry = (state: StepBoundaryState, sessionID: string) =>
  (state.sessions[sessionID] ??= {
    idle: true,
    stepsInExecution: 0,
  })

export const stepBoundary = implementQuery(specification)
  .inputSchema(input)
  .outputSchema<{
    // Which inbox items the next step delivers first (nextDeliverable's
    // boundary): idle admits a queued item, step only steers.
    boundary: 'idle' | 'step'
    stepsInExecution: number
  }>()
  .store(stepBoundaryStore)
  .apply(executionStarted, async (event, state) => {
    state.sessions[event.payload.sessionID] = {
      idle: true,
      stepsInExecution: 0,
    }
  })
  // The next execution resets the boundary when it starts.
  .apply(executionSettled, async () => {})
  .apply(stepStarted, async (event, state) => {
    const session = entry(state, event.payload.sessionID)
    session.idle = false
    session.stepsInExecution += 1
  })
  .apply(stepSettled, async (event, state) => {
    entry(state, event.payload.sessionID).idle =
      event.payload.outcome === 'succeeded' && event.payload.continues !== true
  })
  .handle(async (query, state) => {
    const session = state.sessions[query.sessionID]
    return {
      boundary: session === undefined || session.idle ? 'idle' : 'step',
      stepsInExecution: session?.stepsInExecution ?? 0,
    }
  })

import { SessionID } from '@ocpp/schema/session-id'
import { implementQuery, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection, per Session: what the next step of its execution
// starts from (OC++ runner). An execution starts at an idle boundary; a step
// that continues (tool results to answer) is followed at a step boundary; any
// other settled step leaves the execution idle again. The step count since
// the last delivered input is the agent's step-limit counter; a retried step
// keeps its number. Duplicated on purpose.
type Entry = {
  idle: boolean
  stepsInExecution: number
  stepsSinceInput: number
  retryAt?: number
}

export type NextStepState = {
  sessions: Record<string, Entry>
  // Input items (user, synthetic) by inbox ID: delivering one resets the
  // step-limit counter, a control item does not.
  inputs: Record<string, true>
}

export const nextStepStore = Context.Service<
  SliceStoreService<NextStepState, NextStepState, unknown>
>('@specter/agent-runtime/NextStepStore')

export const createNextStepState = (): NextStepState => ({
  sessions: {},
  inputs: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')
const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const inboxDelivered = sessionEvent('session-inbox-delivered')
const stepStarted = sessionEvent('session-step-started')
const stepSettled = sessionEvent('session-step-settled')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

const fresh = (): Entry => ({
  idle: true,
  stepsInExecution: 0,
  stepsSinceInput: 0,
})

const entry = (state: NextStepState, sessionID: string) =>
  (state.sessions[sessionID] ??= fresh())

export const nextStep = implementQuery(specification)
  .inputSchema(input)
  .outputSchema<{
    // Which inbox items the next step delivers first (nextDeliverable's
    // boundary): idle admits a queued item, step only steers.
    boundary: 'idle' | 'step'
    stepsInExecution: number
    // Steps run since input was last delivered: the next step is one more.
    stepsSinceInput: number
    // When the step being retried is due (epoch milliseconds).
    retryAt?: number
  }>()
  .store(nextStepStore)
  .apply(executionStarted, async (event, state) => {
    state.sessions[event.payload.sessionID] = fresh()
  })
  // The next execution resets everything when it starts.
  .apply(executionSettled, async () => {})
  .apply(inboxEnqueued, async (event, state) => {
    const { inboxID, item } = event.payload
    if (item.type === 'user' || item.type === 'synthetic')
      state.inputs[inboxID] = true
  })
  .apply(inboxDelivered, async (event, state) => {
    if (state.inputs[event.payload.inboxID])
      entry(state, event.payload.sessionID).stepsSinceInput = 0
  })
  .apply(stepStarted, async (event, state) => {
    const session = entry(state, event.payload.sessionID)
    session.idle = false
    session.stepsInExecution += 1
    // A retried step keeps its number.
    if (session.retryAt === undefined) session.stepsSinceInput += 1
    delete session.retryAt
  })
  .apply(stepSettled, async (event, state) => {
    const session = entry(state, event.payload.sessionID)
    const { payload } = event
    session.idle = payload.outcome === 'succeeded' && payload.continues !== true
    if (payload.outcome === 'failed' && payload.retry)
      session.retryAt = payload.retry.at
  })
  .handle(async (query, state) => {
    const session = state.sessions[query.sessionID] ?? fresh()
    return {
      boundary: session.idle ? 'idle' : 'step',
      stepsInExecution: session.stepsInExecution,
      stepsSinceInput: session.stepsSinceInput,
      ...(session.retryAt === undefined ? {} : { retryAt: session.retryAt }),
    }
  })

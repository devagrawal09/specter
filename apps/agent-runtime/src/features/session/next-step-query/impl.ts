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
  // The execution continues an interrupted turn: it never takes queued input.
  continued?: true
  stepsInExecution: number
  stepsSinceInput: number
  retryAt?: number
  // The attempt the next step is of its logical step, after a retry.
  attempt?: number
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
const executionContinued = sessionEvent('session-execution-continued')

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
  }>()
  .store(nextStepStore)
  .apply(executionStarted, async (event, state) => {
    state.sessions[event.payload.sessionID] = fresh()
  })
  .apply(executionContinued, async (event, state) => {
    entry(state, event.payload.sessionID).continued = true
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
    delete session.attempt
    if (payload.outcome === 'failed' && payload.retry) {
      session.retryAt = payload.retry.at
      session.attempt = payload.retry.attempt + 1
    }
  })
  .handle(async (query, state) => {
    const session = state.sessions[query.sessionID] ?? fresh()
    return {
      boundary: !session.idle ? 'step' : session.continued ? 'entry' : 'idle',
      stepsInExecution: session.stepsInExecution,
      stepsSinceInput: session.stepsSinceInput,
      ...(session.retryAt === undefined ? {} : { retryAt: session.retryAt }),
      attempt: session.attempt ?? 1,
    }
  })

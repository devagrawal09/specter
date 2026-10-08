import { SessionID } from '@ocpp/schema/session-id'
import {
  implementReaction,
  type ReactionPlugin,
  type SliceStoreService,
} from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Per-Session projection; the handler derives its request from this state
// alone (no trigger). Duplicated from step-status-query on purpose.
export type RunStepState = {
  sessions: Record<
    string,
    {
      active: boolean
      inFlight: string | null
      stepsStarted: number
      awaitingRetry: boolean
      retrying: boolean
    }
  >
}

export const runStepStore = Context.Service<
  SliceStoreService<RunStepState, RunStepState, unknown>
>('@specter/agent-runtime/RunStepStore')

export const createRunStepState = (): RunStepState => ({ sessions: {} })

const executionStarted = sessionEvent('session-execution-started')
const executionSucceeded = sessionEvent('session-execution-succeeded')
const executionFailed = sessionEvent('session-execution-failed')
const executionInterrupted = sessionEvent('session-execution-interrupted')
const stepStarted = sessionEvent('session-step-started')
const stepEnded = sessionEvent('session-step-ended')
const stepFailed = sessionEvent('session-step-failed')
const retryScheduled = sessionEvent('session-retry-scheduled')

const runStepRequest = Schema.Struct({
  type: Schema.Literal('runStep'),
  payload: Schema.Struct({ sessionID: SessionID, ordinal: Schema.Number }),
})
export type RunStepRequest = typeof runStepRequest.Type

const entry = (state: RunStepState, sessionID: string) =>
  (state.sessions[sessionID] ??= {
    active: false,
    inFlight: null,
    stepsStarted: 0,
    awaitingRetry: false,
    retrying: false,
  })

const settle = (state: RunStepState, sessionID: string) => {
  const session = entry(state, sessionID)
  session.active = false
  session.inFlight = null
  session.awaitingRetry = false
  session.retrying = false
}

// The Plugin is injected: it reads Query Slices, and Slices may not import
// sibling Slices, so src/plugins/run-step.ts owns it and src/app.ts composes
// it (outboxed) with this Reaction.
export const createRunStep = <R>(plugin: ReactionPlugin<RunStepRequest, R>) =>
  implementReaction(specification)
    .outputSchema(Schema.toStandardSchemaV1(runStepRequest))
    .plugin(plugin)
    .store(runStepStore)
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
      // The attempt after a scheduled retry re-runs the same step.
      if (!session.retrying) session.stepsStarted += 1
      session.awaitingRetry = false
      session.retrying = false
    })
    .apply(stepEnded, async (event, state) => {
      const { sessionID, assistantMessageID } = event.payload
      const session = entry(state, sessionID)
      if (session.inFlight === assistantMessageID) session.inFlight = null
    })
    // A failed step needs nothing until a retry is scheduled; without one,
    // only the execution failing follows.
    .apply(stepFailed, async (event, state) => {
      const { sessionID, assistantMessageID } = event.payload
      const session = entry(state, sessionID)
      if (session.inFlight === assistantMessageID) session.inFlight = null
      session.awaitingRetry = true
    })
    .apply(retryScheduled, async (event, state) => {
      const session = entry(state, event.payload.sessionID)
      session.awaitingRetry = false
      session.retrying = true
    })
    .handle(async (state) => {
      // One output per commit: request the lowest Session needing a step; the
      // commit that records its step re-runs this and reaches the next one.
      const sessionID = Object.keys(state.sessions)
        .sort()
        .find((id) => {
          const session = state.sessions[id]
          return session?.active && !session.inFlight && !session.awaitingRetry
        })
      if (sessionID === undefined) return
      const session = state.sessions[sessionID]
      if (!session) return
      return {
        type: 'runStep' as const,
        payload: {
          sessionID,
          // A retried step is the same step: its ordinal is the one just run.
          ordinal: session.retrying
            ? session.stepsStarted - 1
            : session.stepsStarted,
        },
      }
    })

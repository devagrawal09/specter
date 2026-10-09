import { SessionDriver } from '@ocpp/schema/session-driver'
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
      // The step in flight began before this execution started: its process
      // is gone, and a job reconciles it.
      stale?: true
      stepsStarted: number
      awaitingRetry: boolean
      retrying: boolean
      // The Session's model selects an external agent, and the active
      // execution is that agent's (the host drives it whole): its steps are
      // the agent's, never this Reaction's.
      driven?: true
      external?: true
    }
  >
}

export const runStepStore = Context.Service<
  SliceStoreService<RunStepState, RunStepState, unknown>
>('@specter/agent-runtime/RunStepStore')

export const createRunStepState = (): RunStepState => ({ sessions: {} })

const sessionCreated = sessionEvent('session-created')
const modelSelected = sessionEvent('session-model-selected')
const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')
const stepStarted = sessionEvent('session-step-started')
const stepSettled = sessionEvent('session-step-settled')

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

const driver = (
  state: RunStepState,
  sessionID: string,
  model: { readonly providerID: string } | undefined,
) => {
  const session = entry(state, sessionID)
  if (SessionDriver.of(model) === 'ocpp') delete session.driven
  else session.driven = true
}

const settle = (state: RunStepState, sessionID: string) => {
  const session = entry(state, sessionID)
  session.active = false
  delete session.external
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
    .apply(sessionCreated, async (event, state) => {
      driver(state, event.payload.sessionID, event.payload.model)
    })
    .apply(modelSelected, async (event, state) => {
      driver(state, event.payload.sessionID, event.payload.model)
    })
    .apply(executionStarted, async (event, state) => {
      const session = entry(state, event.payload.sessionID)
      session.active = true
      if (session.driven) session.external = true
      if (session.inFlight) session.stale = true
    })
    .apply(executionSettled, async (event, state) => {
      settle(state, event.payload.sessionID)
    })
    .apply(stepStarted, async (event, state) => {
      const { sessionID, assistantMessageID } = event.payload
      const session = entry(state, sessionID)
      session.inFlight = assistantMessageID
      delete session.stale
      // The attempt after a scheduled retry re-runs the same step.
      if (!session.retrying) session.stepsStarted += 1
      session.awaitingRetry = false
      session.retrying = false
    })
    // A failed step without a retry needs nothing: only the execution failing
    // follows, in the same commit.
    .apply(stepSettled, async (event, state) => {
      const { sessionID, assistantMessageID } = event.payload
      const session = entry(state, sessionID)
      if (session.inFlight === assistantMessageID) {
        session.inFlight = null
        delete session.stale
      }
      if (event.payload.outcome !== 'failed') return
      // A fresh retry runs as the next step.
      if (!event.payload.retry) session.awaitingRetry = true
      else if (!event.payload.retry.fresh) session.retrying = true
    })
    .handle(async (state) => {
      // One output per commit: request the lowest Session needing a step; the
      // commit that records its step re-runs this and reaches the next one.
      const sessionID = Object.keys(state.sessions)
        .sort()
        .find((id) => {
          const session = state.sessions[id]
          return (
            session?.active &&
            !session.external &&
            (!session.inFlight || session.stale) &&
            !session.awaitingRetry
          )
        })
      if (sessionID === undefined) return
      const session = state.sessions[sessionID]
      if (!session) return
      return {
        type: 'runStep' as const,
        payload: {
          sessionID,
          // A retried or stale step is the same step: its ordinal is the one
          // already started.
          ordinal:
            session.retrying || session.stale
              ? session.stepsStarted - 1
              : session.stepsStarted,
        },
      }
    })

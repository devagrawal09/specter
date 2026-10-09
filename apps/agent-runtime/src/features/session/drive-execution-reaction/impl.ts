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

// Per-Session projection: whether an external agent drives the Session, and
// its executions. The latest execution started is the one a commit can need
// driven: this Reaction applies only execution starts and settlements and the
// driver's changes, so each start re-runs it once for that Session.
export type DriveExecutionState = {
  sessions: Record<
    string,
    {
      driven?: true
      active: boolean
      // The active execution is the agent's: its driver when it started.
      driving?: true
      executions: number
    }
  >
  latest?: string
}

export const driveExecutionStore = Context.Service<
  SliceStoreService<DriveExecutionState, DriveExecutionState, unknown>
>('@specter/agent-runtime/DriveExecutionStore')

export const createDriveExecutionState = (): DriveExecutionState => ({
  sessions: {},
})

const sessionCreated = sessionEvent('session-created')
const modelSelected = sessionEvent('session-model-selected')
const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')

const driveExecutionRequest = Schema.Struct({
  type: Schema.Literal('driveExecution'),
  payload: Schema.Struct({ sessionID: SessionID, execution: Schema.Number }),
})
export type DriveExecutionRequest = typeof driveExecutionRequest.Type

const entry = (state: DriveExecutionState, sessionID: string) =>
  (state.sessions[sessionID] ??= { active: false, executions: 0 })

const driver = (
  state: DriveExecutionState,
  sessionID: string,
  model: { readonly providerID: string } | undefined,
) => {
  const session = entry(state, sessionID)
  if (SessionDriver.of(model) === 'ocpp') delete session.driven
  else session.driven = true
}

// The Plugin is injected, as the step Reaction's is: src/plugins owns it and
// src/app.ts composes it (outboxed) with this Reaction.
export const createDriveExecution = <R>(
  plugin: ReactionPlugin<DriveExecutionRequest, R>,
) =>
  implementReaction(specification)
    .outputSchema(Schema.toStandardSchemaV1(driveExecutionRequest))
    .plugin(plugin)
    .store(driveExecutionStore)
    .apply(sessionCreated, async (event, state) => {
      driver(state, event.payload.sessionID, event.payload.model)
    })
    .apply(modelSelected, async (event, state) => {
      driver(state, event.payload.sessionID, event.payload.model)
    })
    .apply(executionStarted, async (event, state) => {
      const session = entry(state, event.payload.sessionID)
      session.active = true
      session.executions += 1
      if (session.driven) session.driving = true
      else delete session.driving
      state.latest = event.payload.sessionID
    })
    .apply(executionSettled, async (event, state) => {
      const session = entry(state, event.payload.sessionID)
      session.active = false
      delete session.driving
    })
    .handle(async (state) => {
      const sessionID = state.latest
      const session =
        sessionID === undefined ? undefined : state.sessions[sessionID]
      if (sessionID === undefined || !session?.active || !session.driving)
        return
      return {
        type: 'driveExecution' as const,
        payload: { sessionID, execution: session.executions },
      }
    })

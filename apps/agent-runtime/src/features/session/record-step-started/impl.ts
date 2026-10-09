import { Agent } from '@ocpp/schema/agent'
import { Model } from '@ocpp/schema/model'
import { Snapshot } from '@ocpp/schema/snapshot'
import { SessionID } from '@ocpp/schema/session-id'
import { SessionMessage } from '@ocpp/schema/session-message'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: which Sessions have an active execution, which step
// IDs were used, and which step is in flight. Duplicated from record-step-ended
// and finish-execution on purpose.
export type RecordStepStartedState = {
  active: Record<string, true>
  steps: Record<string, { sessionID: string; retryScheduled: boolean }>
  inFlight: Record<string, string>
}

export const recordStepStartedStore = Context.Service<
  SliceStoreService<RecordStepStartedState, RecordStepStartedState, unknown>
>('@specter/agent-runtime/RecordStepStartedStore')

export const createRecordStepStartedState = (): RecordStepStartedState => ({
  active: {},
  steps: {},
  inFlight: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')
const stepStarted = sessionEvent('session-step-started')
const stepEnded = sessionEvent('session-step-ended')
const stepFailed = sessionEvent('session-step-failed')
const retryScheduled = sessionEvent('session-retry-scheduled')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: SessionID,
    assistantMessageID: SessionMessage.ID,
    agent: Agent.ID,
    model: Model.Ref,
    snapshot: Schema.optional(Snapshot.ID),
  }),
)

// An execution ending abandons its in-flight step (nothing more is recorded
// for it), so the next execution starts clean.
const settle = (state: RecordStepStartedState, sessionID: string) => {
  delete state.active[sessionID]
  delete state.inFlight[sessionID]
}

export const recordStepStarted = implementCommand(specification)
  .inputSchema(input)
  .store(recordStepStartedStore)
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSettled, async (event, state) => {
    settle(state, event.payload.sessionID)
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    state.steps[assistantMessageID] = { sessionID, retryScheduled: false }
    state.inFlight[sessionID] = assistantMessageID
  })
  .apply(stepEnded, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    if (state.inFlight[sessionID] === assistantMessageID)
      delete state.inFlight[sessionID]
  })
  // A failed attempt is over; the step id stays taken until a retry is scheduled.
  .apply(stepFailed, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    if (state.inFlight[sessionID] === assistantMessageID)
      delete state.inFlight[sessionID]
  })
  .apply(retryScheduled, async (event, state) => {
    const step = state.steps[event.payload.assistantMessageID]
    if (step) step.retryScheduled = true
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    // A scheduled retry is the only way to start the same step again.
    const existing = state.steps[command.assistantMessageID]
    if (existing && !existing.retryScheduled)
      throw new Error('Step already started')
    if (state.inFlight[command.sessionID])
      throw new Error('Step already in flight')
    return [
      stepStarted.create({
        sessionID: command.sessionID,
        assistantMessageID: command.assistantMessageID,
        agent: command.agent,
        model: command.model,
        ...(command.snapshot === undefined
          ? {}
          : { snapshot: command.snapshot }),
      }),
    ]
  })

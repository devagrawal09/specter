import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: which Sessions have an active execution, which step
// IDs were used, and which step is in flight. Duplicated from record-step-ended
// and finish-execution on purpose.
export type RecordStepStartedState = {
  active: Record<string, true>
  steps: Record<string, { sessionID: string }>
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
const executionSucceeded = sessionEvent('session-execution-succeeded')
const executionFailed = sessionEvent('session-execution-failed')
const executionInterrupted = sessionEvent('session-execution-interrupted')
const stepStarted = sessionEvent('session-step-started')
const stepEnded = sessionEvent('session-step-ended')

type SessionRef = { sessionID: string }
type StepRef = { sessionID: string; assistantMessageID: string }

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: Schema.String,
    assistantMessageID: Schema.String,
    agent: Schema.String,
    model: Schema.Struct({
      id: Schema.String,
      providerID: Schema.String,
      variant: Schema.optional(Schema.String),
    }),
    snapshot: Schema.optional(Schema.String),
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
    state.active[(event.payload as SessionRef).sessionID] = true
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
    state.steps[assistantMessageID] = { sessionID }
    state.inFlight[sessionID] = assistantMessageID
  })
  .apply(stepEnded, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload as StepRef
    if (state.inFlight[sessionID] === assistantMessageID)
      delete state.inFlight[sessionID]
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    if (state.steps[command.assistantMessageID])
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

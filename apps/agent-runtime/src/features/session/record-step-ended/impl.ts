import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: active executions and each step's status. Duplicated
// from record-step-started on purpose.
export type RecordStepEndedState = {
  active: Record<string, true>
  steps: Record<string, { sessionID: string; status: 'started' | 'ended' }>
}

export const recordStepEndedStore = Context.Service<
  SliceStoreService<RecordStepEndedState, RecordStepEndedState, unknown>
>('@specter/agent-runtime/RecordStepEndedStore')

export const createRecordStepEndedState = (): RecordStepEndedState => ({
  active: {},
  steps: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSucceeded = sessionEvent('session-execution-succeeded')
const executionFailed = sessionEvent('session-execution-failed')
const executionInterrupted = sessionEvent('session-execution-interrupted')
const stepStarted = sessionEvent('session-step-started')
const stepEnded = sessionEvent('session-step-ended')

type SessionRef = { sessionID: string }
type StepRef = { sessionID: string; assistantMessageID: string }

const tokens = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  reasoning: Schema.Number,
  cache: Schema.Struct({ read: Schema.Number, write: Schema.Number }),
})

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: Schema.String,
    assistantMessageID: Schema.String,
    finish: Schema.Literals([
      'stop',
      'length',
      'tool-calls',
      'content-filter',
      'error',
      'unknown',
    ]),
    cost: Schema.optional(Schema.Number),
    tokens: Schema.optional(tokens),
  }),
)

const end = (state: RecordStepEndedState, sessionID: string) => {
  delete state.active[sessionID]
}

export const recordStepEnded = implementCommand(specification)
  .inputSchema(input)
  .store(recordStepEndedStore)
  .apply(executionStarted, async (event, state) => {
    state.active[(event.payload as SessionRef).sessionID] = true
  })
  .apply(executionSucceeded, async (event, state) => {
    end(state, (event.payload as SessionRef).sessionID)
  })
  .apply(executionFailed, async (event, state) => {
    end(state, (event.payload as SessionRef).sessionID)
  })
  .apply(executionInterrupted, async (event, state) => {
    end(state, (event.payload as SessionRef).sessionID)
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload as StepRef
    state.steps[assistantMessageID] = { sessionID, status: 'started' }
  })
  .apply(stepEnded, async (event, state) => {
    const step = state.steps[(event.payload as StepRef).assistantMessageID]
    if (step) step.status = 'ended'
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    const step = state.steps[command.assistantMessageID]
    if (!step || step.sessionID !== command.sessionID)
      throw new Error('Step not started')
    if (step.status === 'ended') throw new Error('Step already ended')
    return [
      stepEnded.create({
        sessionID: command.sessionID,
        assistantMessageID: command.assistantMessageID,
        finish: command.finish,
        cost: command.cost ?? 0,
        tokens: command.tokens ?? {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      }),
    ]
  })

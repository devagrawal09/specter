import { implementReaction, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Reaction handlers receive only slice state, so the state remembers which
// Session the latest relevant commit enqueued for (`wakeFor`). Any other
// execution event clears it, so a later start/end commit requests nothing.
export type WakeExecutionState = {
  active: Record<string, true>
  wakeFor: string | null
}

export const wakeExecutionStore = Context.Service<
  SliceStoreService<WakeExecutionState, WakeExecutionState, unknown>
>('@specter/agent-runtime/WakeExecutionStore')

export const createWakeExecutionState = (): WakeExecutionState => ({
  active: {},
  wakeFor: null,
})

const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const executionStarted = sessionEvent('session-execution-started')
const executionSucceeded = sessionEvent('session-execution-succeeded')
const executionFailed = sessionEvent('session-execution-failed')
const executionInterrupted = sessionEvent('session-execution-interrupted')

type SessionRef = { sessionID: string }

const startExecutionRequest = Schema.toStandardSchemaV1(
  Schema.Struct({
    type: Schema.Literal('startExecution'),
    payload: Schema.Struct({ sessionID: Schema.String }),
  }),
)

const ended = (state: WakeExecutionState, sessionID: string) => {
  delete state.active[sessionID]
  state.wakeFor = null
}

export const wakeExecution = implementReaction(specification)
  .outputSchema(startExecutionRequest)
  .store(wakeExecutionStore)
  .apply(inboxEnqueued, async (event, state) => {
    state.wakeFor = (event.payload as SessionRef).sessionID
  })
  .apply(executionStarted, async (event, state) => {
    state.active[(event.payload as SessionRef).sessionID] = true
    state.wakeFor = null
  })
  .apply(executionSucceeded, async (event, state) => {
    ended(state, (event.payload as SessionRef).sessionID)
  })
  .apply(executionFailed, async (event, state) => {
    ended(state, (event.payload as SessionRef).sessionID)
  })
  .apply(executionInterrupted, async (event, state) => {
    ended(state, (event.payload as SessionRef).sessionID)
  })
  .handle(async (state) => {
    const sessionID = state.wakeFor
    if (sessionID === null || state.active[sessionID]) return
    return {
      type: 'startExecution' as const,
      payload: { sessionID },
    }
  })

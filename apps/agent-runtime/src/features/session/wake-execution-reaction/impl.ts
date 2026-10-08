import { SessionID } from '@ocpp/schema/session-id'
import { implementReaction, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Per-Session projection, like apps/reference's cheer reaction: the handler
// derives its request purely from this state, with no trigger field.
// - pending: enqueued items neither delivered nor cancelled.
// - active: an execution started and not yet succeeded/failed/interrupted.
// - interrupted: the last busy period ended by interruption and no input has
//   been enqueued since. Interruption never deletes pending input, but it must
//   not re-wake the Session by itself either (only a new enqueue wakes);
//   without this flag "pending > 0 and idle" would restart right after the
//   user stopped it. Cleared by the next enqueue or start.
export type WakeExecutionState = {
  sessions: Record<
    string,
    { pending: number; active: boolean; interrupted: boolean }
  >
}

export const wakeExecutionStore = Context.Service<
  SliceStoreService<WakeExecutionState, WakeExecutionState, unknown>
>('@specter/agent-runtime/WakeExecutionStore')

export const createWakeExecutionState = (): WakeExecutionState => ({
  sessions: {},
})

const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const inboxDelivered = sessionEvent('session-inbox-delivered')
const inboxCancelled = sessionEvent('session-inbox-cancelled')
const executionStarted = sessionEvent('session-execution-started')
const executionSucceeded = sessionEvent('session-execution-succeeded')
const executionFailed = sessionEvent('session-execution-failed')
const executionInterrupted = sessionEvent('session-execution-interrupted')

const startExecutionRequest = Schema.toStandardSchemaV1(
  Schema.Struct({
    type: Schema.Literal('startExecution'),
    payload: Schema.Struct({ sessionID: SessionID }),
  }),
)

const entry = (state: WakeExecutionState, sessionID: string) =>
  (state.sessions[sessionID] ??= {
    pending: 0,
    active: false,
    interrupted: false,
  })

const consumed = (state: WakeExecutionState, sessionID: string) => {
  const session = entry(state, sessionID)
  session.pending = Math.max(0, session.pending - 1)
}

const ended = (state: WakeExecutionState, sessionID: string) => {
  entry(state, sessionID).active = false
}

export const wakeExecution = implementReaction(specification)
  .outputSchema(startExecutionRequest)
  .store(wakeExecutionStore)
  .apply(inboxEnqueued, async (event, state) => {
    const session = entry(state, event.payload.sessionID)
    session.pending += 1
    session.interrupted = false
  })
  .apply(inboxDelivered, async (event, state) => {
    consumed(state, event.payload.sessionID)
  })
  .apply(inboxCancelled, async (event, state) => {
    consumed(state, event.payload.sessionID)
  })
  .apply(executionStarted, async (event, state) => {
    const session = entry(state, event.payload.sessionID)
    session.active = true
    session.interrupted = false
  })
  .apply(executionSucceeded, async (event, state) => {
    ended(state, event.payload.sessionID)
  })
  .apply(executionFailed, async (event, state) => {
    ended(state, event.payload.sessionID)
  })
  .apply(executionInterrupted, async (event, state) => {
    const sessionID = event.payload.sessionID
    ended(state, sessionID)
    entry(state, sessionID).interrupted = true
  })
  .handle(async (state) => {
    // A Reaction commit yields zero or one output (docs/architecture/
    // plugins.md, Invariants), so request the lowest waking Session. The
    // resulting execution-started commit re-runs this Reaction, which then
    // requests the next Session: every Session needing a wake is woken in
    // sessionID order across commits.
    const sessionID = Object.keys(state.sessions)
      .sort()
      .find((id) => {
        const session = state.sessions[id]
        return (
          session !== undefined &&
          session.pending > 0 &&
          !session.active &&
          !session.interrupted
        )
      })
    if (sessionID === undefined) return
    return { type: 'startExecution' as const, payload: { sessionID } }
  })

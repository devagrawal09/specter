import { SessionID } from '@ocpp/schema/session-id'
import {
  implementReaction,
  type ReactionPlugin,
  type SliceStoreService,
  SpecterCommandRejectedError,
} from '@specter-ts/core'
import { Context, Effect, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Per-Session projection, like apps/reference's cheer reaction: the handler
// derives its request purely from this state, with no trigger field.
// - waking: enqueued items that wake the Session, until delivered or
//   cancelled. A held item waits for the next wake instead. An execution
//   takes the wakes recorded before it started (OC++'s coordinator: a wake
//   starts a drain, and only one rung while it ran starts another), so input
//   it never delivered, when it fails, waits for the next wake. An
//   interruption empties the set too: it never deletes pending input, but
//   must not re-wake the Session by itself either, or it would restart right
//   after the user stopped it; only a new waking input does.
// - active: an execution started and not yet settled.
// A Session an external agent runs is woken like any other: the host drives
// its executions (the driveExecution Reaction).
export type WakeExecutionState = {
  sessions: Record<
    string,
    {
      waking: Record<string, true>
      active: boolean
    }
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
const inboxHeld = sessionEvent('session-inbox-held')
const executionStarted = sessionEvent('session-execution-started')
const executionSettled = sessionEvent('session-execution-settled')

const startExecutionRequest = Schema.toStandardSchemaV1(
  Schema.Struct({
    type: Schema.Literal('startExecution'),
    payload: Schema.Struct({ sessionID: SessionID }),
  }),
)

const entry = (state: WakeExecutionState, sessionID: string) =>
  (state.sessions[sessionID] ??= {
    waking: {},
    active: false,
  })

const settled = (
  state: WakeExecutionState,
  payload: { readonly sessionID: string; readonly inboxID: string },
) => {
  delete entry(state, payload.sessionID).waking[payload.inboxID]
}

// The request is derived from the state as of its commit, so it can be stale
// by the time it runs: a start the runtime rejects (already active, nothing
// left to deliver) means the world moved on, and a later commit wakes whatever
// still needs waking. A rejection must not stop the Reaction.
const startUnlessMovedOn: ReactionPlugin<{
  readonly type: 'startExecution'
  readonly payload: { readonly sessionID: string }
}> = ({ command }) =>
  Effect.succeed((output, context) =>
    command(output, { idempotencyKey: context.deliveryId }).pipe(
      Effect.asVoid,
      Effect.catchIf(
        (error) => error instanceof SpecterCommandRejectedError,
        () => Effect.void,
      ),
    ),
  )

export const wakeExecution = implementReaction(specification)
  .outputSchema(startExecutionRequest)
  .plugin(startUnlessMovedOn)
  .store(wakeExecutionStore)
  .apply(inboxEnqueued, async (event, state) => {
    entry(state, event.payload.sessionID).waking[event.payload.inboxID] = true
  })
  .apply(inboxHeld, async (event, state) => {
    settled(state, event.payload)
  })
  .apply(inboxDelivered, async (event, state) => {
    settled(state, event.payload)
  })
  .apply(inboxCancelled, async (event, state) => {
    settled(state, event.payload)
  })
  .apply(executionStarted, async (event, state) => {
    const session = entry(state, event.payload.sessionID)
    session.active = true
    session.waking = {}
  })
  .apply(executionSettled, async (event, state) => {
    const session = entry(state, event.payload.sessionID)
    session.active = false
    if (event.payload.outcome === 'interrupted') session.waking = {}
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
          Object.keys(session.waking).length > 0 &&
          !session.active
        )
      })
    if (sessionID === undefined) return
    return { type: 'startExecution' as const, payload: { sessionID } }
  })

import { SessionFork } from '@ocpp/schema/session-fork'
import { SessionID } from '@ocpp/schema/session-id'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import { forkCut, revertCut } from '../history-fold.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: known Sessions, each Session's history as an ordered
// list of message IDs (delivered inbox items and assistant messages), and each
// fork's parent. A fork copies the parent's list up to the boundary, as the
// OC++ projector copies message rows. Cut rules are shared in
// ../history-fold.ts.
export type ForkSessionState = {
  sessions: Record<string, true>
  history: Record<string, string[]>
  parents: Record<string, string>
}

export const forkSessionStore = Context.Service<
  SliceStoreService<ForkSessionState, ForkSessionState, unknown>
>('@specter/agent-runtime/ForkSessionStore')

export const createForkSessionState = (): ForkSessionState => ({
  sessions: {},
  history: {},
  parents: {},
})

const sessionCreated = sessionEvent('session-created')
const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const inboxDelivered = sessionEvent('session-inbox-delivered')
const stepStarted = sessionEvent('session-step-started')
const sessionForked = sessionEvent('session-forked')
const revertCommitted = sessionEvent('session-revert-committed')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: SessionID,
    parentID: SessionID,
    boundary: SessionFork.Boundary,
  }),
)

const messages = (state: ForkSessionState, sessionID: string) =>
  (state.history[sessionID] ??= [])

const cut = (
  history: readonly string[],
  boundary: { type: 'before' | 'through'; messageID: string },
) => forkCut(history, boundary, (id) => id)

export const forkSession = implementCommand(specification)
  .inputSchema(input)
  .store(forkSessionStore)
  .apply(sessionCreated, async (event, state) => {
    state.sessions[event.payload.sessionID] = true
  })
  // Pending items are not history yet; only delivery puts one there.
  .apply(inboxEnqueued, async () => {})
  .apply(inboxDelivered, async (event, state) => {
    const { sessionID, inboxID } = event.payload
    messages(state, sessionID).push(inboxID)
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    const history = messages(state, sessionID)
    // A retried step reuses its message.
    if (!history.includes(assistantMessageID)) history.push(assistantMessageID)
  })
  .apply(sessionForked, async (event, state) => {
    const { sessionID, parentID, boundary } = event.payload
    const parent = messages(state, parentID)
    state.history[sessionID] = parent.slice(0, cut(parent, boundary))
    state.parents[sessionID] = parentID
  })
  // Committed revert: history ends at the boundary (inclusive), so a later
  // fork copies only the post-revert history.
  .apply(revertCommitted, async (event, state) => {
    const { sessionID, to } = event.payload
    const kept = revertCut(messages(state, sessionID), to, (id) => id)
    if (kept) state.history[sessionID] = kept
  })
  .handle(async (command, state) => {
    if (!state.sessions[command.sessionID]) throw new Error('Session not found')
    if (!state.sessions[command.parentID])
      throw new Error('Parent session not found')
    // Walk up from the parent: reaching the child (or being it) is a cycle.
    for (
      let ancestor: string | undefined = command.parentID;
      ancestor !== undefined;
      ancestor = state.parents[ancestor]
    ) {
      if (ancestor === command.sessionID)
        throw new Error('Fork would create a cycle')
    }
    if (state.parents[command.sessionID] !== undefined)
      throw new Error('Session already forked')
    if (messages(state, command.sessionID).length > 0)
      throw new Error('Session already has history')
    if (cut(messages(state, command.parentID), command.boundary) === -1)
      throw new Error('Boundary message not found in parent history')
    return [
      sessionForked.create({
        sessionID: command.sessionID,
        parentID: command.parentID,
        boundary: command.boundary,
      }),
    ]
  })

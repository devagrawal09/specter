import { SessionID } from '@ocpp/schema/session-id'
import { SessionMessage } from '@ocpp/schema/session-message'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: known Sessions, each Session's history as an ordered
// list of message IDs (delivered inbox items and assistant messages, cut at a
// committed revert and copied through a fork), and whether an execution is
// active. Duplicated from session-history-query on purpose.
export type StageRevertState = {
  sessions: Record<string, true>
  history: Record<string, string[]>
  active: Record<string, true>
}

export const stageRevertStore = Context.Service<
  SliceStoreService<StageRevertState, StageRevertState, unknown>
>('@specter/agent-runtime/StageRevertStore')

export const createStageRevertState = (): StageRevertState => ({
  sessions: {},
  history: {},
  active: {},
})

const sessionCreated = sessionEvent('session-created')
const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const inboxDelivered = sessionEvent('session-inbox-delivered')
const stepStarted = sessionEvent('session-step-started')
const sessionForked = sessionEvent('session-forked')
const executionStarted = sessionEvent('session-execution-started')
const executionSucceeded = sessionEvent('session-execution-succeeded')
const executionFailed = sessionEvent('session-execution-failed')
const executionInterrupted = sessionEvent('session-execution-interrupted')
const revertStaged = sessionEvent('session-revert-staged')
const revertCommitted = sessionEvent('session-revert-committed')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({ sessionID: SessionID, messageID: SessionMessage.ID }),
)

const messages = (state: StageRevertState, sessionID: string) =>
  (state.history[sessionID] ??= [])

export const stageRevert = implementCommand(specification)
  .inputSchema(input)
  .store(stageRevertStore)
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
    const index = parent.indexOf(boundary.messageID)
    if (index === -1) return
    state.history[sessionID] = parent.slice(
      0,
      boundary.type === 'before' ? index : index + 1,
    )
  })
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSucceeded, async (event, state) => {
    delete state.active[event.payload.sessionID]
  })
  .apply(executionFailed, async (event, state) => {
    delete state.active[event.payload.sessionID]
  })
  .apply(executionInterrupted, async (event, state) => {
    delete state.active[event.payload.sessionID]
  })
  // Staging changes nothing this Command needs; it is in Given for realism.
  .apply(revertStaged, async () => {})
  // Committed revert: history ends at the boundary message (inclusive).
  .apply(revertCommitted, async (event, state) => {
    const { sessionID, to } = event.payload
    const history = messages(state, sessionID)
    const index = history.indexOf(to)
    if (index !== -1) state.history[sessionID] = history.slice(0, index + 1)
  })
  .handle(async (command, state) => {
    if (!state.sessions[command.sessionID]) throw new Error('Session not found')
    if (state.active[command.sessionID]) throw new Error('Session is busy')
    if (!messages(state, command.sessionID).includes(command.messageID))
      throw new Error('Message not found')
    return [
      revertStaged.create({
        sessionID: command.sessionID,
        revert: { messageID: command.messageID },
      }),
    ]
  })

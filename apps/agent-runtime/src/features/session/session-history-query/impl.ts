import { SessionID } from '@ocpp/schema/session-id'
import { implementQuery, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import { forkCut, revertCut } from '../history-fold.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection of Session history. A fork copies the parent's items
// up to the boundary when session.forked is folded (as the OC++ projector
// copies message rows), so the copy is frozen at the fork. The cut rules live
// in ../history-fold.ts, shared by the four history projections.
type Item = {
  messageID: string
  // The Session that recorded the message.
  sessionID: string
  type: 'user' | 'synthetic' | 'assistant'
  status?: 'started' | 'ended' | 'failed'
}

export type SessionHistoryState = {
  // Item type by inbox ID, known from the enqueued fact; delivery adds the
  // item to history.
  inbox: Record<string, 'user' | 'synthetic'>
  history: Record<string, Item[]>
}

export const sessionHistoryStore = Context.Service<
  SliceStoreService<SessionHistoryState, SessionHistoryState, unknown>
>('@specter/agent-runtime/SessionHistoryStore')

export const createSessionHistoryState = (): SessionHistoryState => ({
  inbox: {},
  history: {},
})

const sessionCreated = sessionEvent('session-created')
const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const inboxDelivered = sessionEvent('session-inbox-delivered')
const stepStarted = sessionEvent('session-step-started')
const stepSettled = sessionEvent('session-step-settled')
const sessionForked = sessionEvent('session-forked')
const revertStaged = sessionEvent('session-revert-staged')
const revertCommitted = sessionEvent('session-revert-committed')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

const items = (state: SessionHistoryState, sessionID: string) =>
  (state.history[sessionID] ??= [])

const mark = (
  state: SessionHistoryState,
  sessionID: string,
  messageID: string,
  status: 'started' | 'ended' | 'failed',
) => {
  const history = items(state, sessionID)
  const existing = history.find(
    (item) => item.messageID === messageID && item.sessionID === sessionID,
  )
  if (existing) existing.status = status
  // A retried step reuses its message, so only a new one is appended.
  else history.push({ messageID, sessionID, type: 'assistant', status })
}

export const sessionHistory = implementQuery(specification)
  .inputSchema(input)
  .outputSchema<{ items: Item[] }>()
  .store(sessionHistoryStore)
  // History starts at the first delivery or step; creation adds nothing.
  .apply(sessionCreated, async () => {})
  .apply(inboxEnqueued, async (event, state) => {
    const { inboxID, item } = event.payload
    // Compaction and move items are not conversation messages.
    if (item.type === 'user' || item.type === 'synthetic')
      state.inbox[inboxID] ??= item.type
  })
  .apply(inboxDelivered, async (event, state) => {
    const { sessionID, inboxID } = event.payload
    const type = state.inbox[inboxID]
    if (type)
      items(state, sessionID).push({ messageID: inboxID, sessionID, type })
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    mark(state, sessionID, assistantMessageID, 'started')
  })
  .apply(stepSettled, async (event, state) => {
    const { sessionID, assistantMessageID, outcome } = event.payload
    mark(
      state,
      sessionID,
      assistantMessageID,
      outcome === 'succeeded' ? 'ended' : 'failed',
    )
  })
  .apply(sessionForked, async (event, state) => {
    const { sessionID, parentID, boundary } = event.payload
    const parent = items(state, parentID)
    const end = forkCut(parent, boundary, (item) => item.messageID)
    if (end === -1) return
    state.history[sessionID] = parent.slice(0, end).map((item) => ({ ...item }))
  })
  // A staged revert is not yet history: only the commit changes it.
  .apply(revertStaged, async () => {})
  // Committed revert: history ends at the boundary message (inclusive). A
  // projection only; the Event Log is untouched. Pending inbox items are not
  // history and revert.ts does not mention them, so they stay pending.
  .apply(revertCommitted, async (event, state) => {
    const { sessionID, to } = event.payload
    const kept = revertCut(
      items(state, sessionID),
      to,
      (item) => item.messageID,
    )
    if (kept) state.history[sessionID] = kept
  })
  .handle(async (query, state) => ({
    items: state.history[query.sessionID] ?? [],
  }))

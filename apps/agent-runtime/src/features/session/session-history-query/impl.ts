import { SessionID } from '@ocpp/schema/session-id'
import { implementQuery, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection of Session history. A fork copies the parent's items
// up to the boundary when session.forked is folded (as the OC++ projector
// copies message rows), so the copy is frozen at the fork. Duplicated from
// fork-session on purpose.
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
const stepEnded = sessionEvent('session-step-ended')
const stepFailed = sessionEvent('session-step-failed')
const sessionForked = sessionEvent('session-forked')

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
  .apply(stepEnded, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    mark(state, sessionID, assistantMessageID, 'ended')
  })
  .apply(stepFailed, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    mark(state, sessionID, assistantMessageID, 'failed')
  })
  .apply(sessionForked, async (event, state) => {
    const { sessionID, parentID, boundary } = event.payload
    const parent = items(state, parentID)
    const index = parent.findIndex(
      (item) => item.messageID === boundary.messageID,
    )
    if (index === -1) return
    const end = boundary.type === 'before' ? index : index + 1
    state.history[sessionID] = parent.slice(0, end).map((item) => ({ ...item }))
  })
  .handle(async (query, state) => ({
    items: state.history[query.sessionID] ?? [],
  }))

import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: known Sessions and each inbox item's status.
// Duplicated from enqueue-input on purpose.
export type CancelInboxItemState = {
  sessions: Record<string, true>
  items: Record<
    string,
    { sessionID: string; status: 'pending' | 'delivered' | 'cancelled' }
  >
}

export const cancelInboxItemStore = Context.Service<
  SliceStoreService<CancelInboxItemState, CancelInboxItemState, unknown>
>('@specter/agent-runtime/CancelInboxItemStore')

export const createCancelInboxItemState = (): CancelInboxItemState => ({
  sessions: {},
  items: {},
})

const sessionCreated = sessionEvent('session-created')
const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const inboxDelivered = sessionEvent('session-inbox-delivered')
const inboxCancelled = sessionEvent('session-inbox-cancelled')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({ sessionID: Schema.String, inboxID: Schema.String }),
)

type InboxRef = { sessionID: string; inboxID: string }

export const cancelInboxItem = implementCommand(specification)
  .inputSchema(input)
  .store(cancelInboxItemStore)
  .apply(sessionCreated, async (event, state) => {
    const { sessionID } = event.payload as { sessionID: string }
    state.sessions[sessionID] = true
  })
  .apply(inboxEnqueued, async (event, state) => {
    const { sessionID, inboxID } = event.payload as InboxRef
    state.items[inboxID] ??= { sessionID, status: 'pending' }
  })
  .apply(inboxDelivered, async (event, state) => {
    const { inboxID } = event.payload as InboxRef
    const item = state.items[inboxID]
    if (item) item.status = 'delivered'
  })
  .apply(inboxCancelled, async (event, state) => {
    const { inboxID } = event.payload as InboxRef
    const item = state.items[inboxID]
    if (item) item.status = 'cancelled'
  })
  .handle(async (command, state) => {
    if (!state.sessions[command.sessionID]) throw new Error('Session not found')

    const item = state.items[command.inboxID]
    if (!item || item.sessionID !== command.sessionID)
      throw new Error('Inbox item not found')
    if (item.status === 'delivered')
      throw new Error('Inbox item already delivered')
    if (item.status === 'cancelled')
      throw new Error('Inbox item already cancelled')
    return [
      inboxCancelled.create({
        sessionID: command.sessionID,
        inboxID: command.inboxID,
      }),
    ]
  })

import { SessionID } from '@ocpp/schema/session-id'
import { SessionMessage } from '@ocpp/schema/session-message'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: known Sessions and each inbox item's status.
// Duplicated from cancel-inbox-item on purpose.
export type DeliverInboxItemState = {
  sessions: Record<string, true>
  items: Record<
    string,
    { sessionID: string; status: 'pending' | 'delivered' | 'cancelled' }
  >
}

export const deliverInboxItemStore = Context.Service<
  SliceStoreService<DeliverInboxItemState, DeliverInboxItemState, unknown>
>('@specter/agent-runtime/DeliverInboxItemStore')

export const createDeliverInboxItemState = (): DeliverInboxItemState => ({
  sessions: {},
  items: {},
})

const sessionCreated = sessionEvent('session-created')
const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const inboxDelivered = sessionEvent('session-inbox-delivered')
const inboxCancelled = sessionEvent('session-inbox-cancelled')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({ sessionID: SessionID, inboxID: SessionMessage.ID }),
)

export const deliverInboxItem = implementCommand(specification)
  .inputSchema(input)
  .store(deliverInboxItemStore)
  .apply(sessionCreated, async (event, state) => {
    const { sessionID } = event.payload
    state.sessions[sessionID] = true
  })
  .apply(inboxEnqueued, async (event, state) => {
    const { sessionID, inboxID } = event.payload
    state.items[inboxID] ??= { sessionID, status: 'pending' }
  })
  .apply(inboxDelivered, async (event, state) => {
    const item = state.items[event.payload.inboxID]
    if (item) item.status = 'delivered'
  })
  .apply(inboxCancelled, async (event, state) => {
    const item = state.items[event.payload.inboxID]
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
      inboxDelivered.create({
        sessionID: command.sessionID,
        inboxID: command.inboxID,
      }),
    ]
  })

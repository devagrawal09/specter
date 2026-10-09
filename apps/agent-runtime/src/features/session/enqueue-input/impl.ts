import { SessionID } from '@ocpp/schema/session-id'
import { SessionInbox } from '@ocpp/schema/session-inbox'
import { SessionMessage } from '@ocpp/schema/session-message'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Slice state is a rebuildable projection of the Event Log: which Sessions
// exist, which Session/type each inbox ID was admitted under, and whether it
// is still pending. It is a duplicate of the projection in cancel-inbox-item on
// purpose.
export type EnqueueInputState = {
  sessions: Record<string, true>
  items: Record<string, { sessionID: string; type: string; pending: boolean }>
}

export const enqueueInputStore = Context.Service<
  SliceStoreService<EnqueueInputState, EnqueueInputState, unknown>
>('@specter/agent-runtime/EnqueueInputStore')

export const createEnqueueInputState = (): EnqueueInputState => ({
  sessions: {},
  items: {},
})

const sessionCreated = sessionEvent('session-created')
const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const inboxDelivered = sessionEvent('session-inbox-delivered')
const inboxCancelled = sessionEvent('session-inbox-cancelled')
const revertCommitted = sessionEvent('session-revert-committed')

const base = {
  sessionID: SessionID,
  inboxID: SessionMessage.ID,
  delivery: Schema.optional(SessionInbox.Delivery),
  resume: Schema.optional(Schema.Boolean),
  // Pending items of the same Session this input replaces (OC++ coalescing):
  // they are cancelled in the same commit.
  replaces: Schema.optional(Schema.Array(SessionMessage.ID)),
}

// The flat Command input, discriminated on `type` so the payload reaches the
// event as OC++'s own Session.Inbox.Item without a cast.
const commandSchema = Schema.Union([
  Schema.Struct({
    ...base,
    type: Schema.Literal('user'),
    payload: SessionInbox.UserPayload,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal('synthetic'),
    payload: SessionInbox.SyntheticPayload,
  }),
  // Control items: a manual compaction, and a move to another Location.
  Schema.Struct({
    ...base,
    type: Schema.Literal('compaction'),
    payload: SessionInbox.CompactionPayload,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal('move'),
    payload: SessionInbox.MovePayload,
  }),
])
type Command = typeof commandSchema.Type
const input = Schema.toStandardSchemaV1(commandSchema)

// The admitted item as OC++'s Session.Inbox.Item, with steer as the default
// delivery.
const item = (command: Command) => {
  const delivery = command.delivery ?? 'steer'
  switch (command.type) {
    case 'user':
      return { type: 'user' as const, payload: command.payload, delivery }
    case 'synthetic':
      return { type: 'synthetic' as const, payload: command.payload, delivery }
    case 'compaction':
      return { type: 'compaction' as const, payload: command.payload, delivery }
    case 'move':
      return { type: 'move' as const, payload: command.payload, delivery }
  }
}

export const enqueueInput = implementCommand(specification)
  .inputSchema(input)
  .store(enqueueInputStore)
  .apply(sessionCreated, async (event, state) => {
    const { sessionID } = event.payload
    state.sessions[sessionID] = true
  })
  .apply(inboxEnqueued, async (event, state) => {
    const { sessionID, inboxID, item } = event.payload
    state.items[inboxID] ??= { sessionID, type: item.type, pending: true }
  })
  .apply(inboxDelivered, async (event, state) => {
    const item = state.items[event.payload.inboxID]
    if (item) item.pending = false
  })
  .apply(inboxCancelled, async (event, state) => {
    const item = state.items[event.payload.inboxID]
    if (item) item.pending = false
  })
  // Deliberately a no-op: a committed revert does not affect admission; the
  // scenario puts it in Given to prove admission works normally afterwards.
  .apply(revertCommitted, async () => {})
  .handle(async (command, state) => {
    if (!state.sessions[command.sessionID]) throw new Error('Session not found')

    const existing = state.items[command.inboxID]
    if (existing) {
      if (existing.sessionID !== command.sessionID)
        throw new Error('Inbox item belongs to a different session')
      if (existing.type !== command.type)
        throw new Error('Inbox item type does not match existing item')
      throw new Error('Inbox item already admitted')
    }

    // A replaced item must still be pending, or the replacement would drop
    // input that was already delivered or cancelled: the caller decides again.
    const replaced = command.replaces ?? []
    for (const inboxID of replaced) {
      const item = state.items[inboxID]
      if (item?.sessionID !== command.sessionID || !item.pending)
        throw new Error('Replaced input not pending')
    }

    // `resume` only controls scheduling (a reaction on the enqueued event),
    // so it is not part of the durable fact.
    return [
      ...replaced.map((inboxID) =>
        inboxCancelled.create({ sessionID: command.sessionID, inboxID }),
      ),
      inboxEnqueued.create({
        sessionID: command.sessionID,
        inboxID: command.inboxID,
        item: item(command),
      }),
    ]
  })

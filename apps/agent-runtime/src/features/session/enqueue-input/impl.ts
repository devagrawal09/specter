import { SessionID } from '@ocpp/schema/session-id'
import { SessionInbox } from '@ocpp/schema/session-inbox'
import { SessionMessage } from '@ocpp/schema/session-message'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Slice state is a rebuildable projection of the Event Log: which Sessions
// exist and which Session/type each inbox ID was admitted under. It is a
// duplicate of the projection in cancel-inbox-item on purpose.
export type EnqueueInputState = {
  sessions: Record<string, true>
  items: Record<string, { sessionID: string; type: string }>
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

const base = {
  sessionID: SessionID,
  inboxID: SessionMessage.ID,
  delivery: Schema.optional(SessionInbox.Delivery),
  resume: Schema.optional(Schema.Boolean),
}

// The flat Command input, discriminated on `type` so the payload reaches the
// event as OC++'s own Session.Inbox.Item without a cast.
const input = Schema.toStandardSchemaV1(
  Schema.Union([
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
  ]),
)

export const enqueueInput = implementCommand(specification)
  .inputSchema(input)
  .store(enqueueInputStore)
  .apply(sessionCreated, async (event, state) => {
    const { sessionID } = event.payload
    state.sessions[sessionID] = true
  })
  .apply(inboxEnqueued, async (event, state) => {
    const { sessionID, inboxID, item } = event.payload
    state.items[inboxID] ??= { sessionID, type: item.type }
  })
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

    // `resume` only controls scheduling (a reaction on the enqueued event),
    // so it is not part of the durable fact.
    return [
      inboxEnqueued.create({
        sessionID: command.sessionID,
        inboxID: command.inboxID,
        item:
          command.type === 'user'
            ? {
                type: 'user',
                payload: command.payload,
                delivery: command.delivery ?? 'steer',
              }
            : {
                type: 'synthetic',
                payload: command.payload,
                delivery: command.delivery ?? 'steer',
              },
      }),
    ]
  })

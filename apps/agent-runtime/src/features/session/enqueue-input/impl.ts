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

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: Schema.String,
    inboxID: Schema.String,
    type: Schema.Literals(['user', 'synthetic']),
    payload: Schema.Record(Schema.String, Schema.Unknown),
    delivery: Schema.optional(Schema.Literals(['steer', 'queue'])),
    resume: Schema.optional(Schema.Boolean),
  }),
)

export const enqueueInput = implementCommand(specification)
  .inputSchema(input)
  .store(enqueueInputStore)
  .apply(sessionCreated, async (event, state) => {
    const { sessionID } = event.payload as { sessionID: string }
    state.sessions[sessionID] = true
  })
  .apply(inboxEnqueued, async (event, state) => {
    const { sessionID, inboxID, item } = event.payload as {
      sessionID: string
      inboxID: string
      item: { type: string }
    }
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
        item: {
          type: command.type,
          payload: command.payload,
          delivery: command.delivery ?? 'steer',
        },
      }),
    ]
  })

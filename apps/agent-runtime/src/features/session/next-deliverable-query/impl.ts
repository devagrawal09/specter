import { SessionID } from '@ocpp/schema/session-id'
import { implementQuery, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: per-Session inbox items in enqueue order. The
// Event Log owns what happened; this only folds it.
type InboxItem = {
  inboxID: string
  type: string
  delivery: 'steer' | 'queue'
  status: 'pending' | 'delivered' | 'cancelled'
}

export type NextDeliverableState = {
  sessions: Record<string, InboxItem[]>
}

export const nextDeliverableStore = Context.Service<
  SliceStoreService<NextDeliverableState, NextDeliverableState, unknown>
>('@specter/agent-runtime/NextDeliverableStore')

export const createNextDeliverableState = (): NextDeliverableState => ({
  sessions: {},
})

const inboxEnqueued = sessionEvent('session-inbox-enqueued')
const inboxDelivered = sessionEvent('session-inbox-delivered')
const inboxCancelled = sessionEvent('session-inbox-cancelled')
const inboxDeliveryChanged = sessionEvent('session-inbox-delivery-changed')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: SessionID,
    boundary: Schema.Literals(['step', 'idle']),
  }),
)

const find = (
  state: NextDeliverableState,
  ref: { sessionID: string; inboxID: string },
) => state.sessions[ref.sessionID]?.find((item) => item.inboxID === ref.inboxID)

// Control items form a delivery boundary that later items never cross.
const controlTypes = new Set(['compaction', 'move'])

const deliverable = (item: InboxItem, reason: string) => ({
  item: { inboxID: item.inboxID, type: item.type, delivery: item.delivery },
  reason,
})

export const nextDeliverable = implementQuery(specification)
  .inputSchema(input)
  .outputSchema<{
    item: { inboxID: string; type: string; delivery: string } | null
    reason: string
  }>()
  .store(nextDeliverableStore)
  .apply(inboxEnqueued, async (event, state) => {
    const { sessionID, inboxID, item } = event.payload
    const items = state.sessions[sessionID] ?? []
    state.sessions[sessionID] = items
    if (items.some((existing) => existing.inboxID === inboxID)) return
    items.push({
      inboxID,
      type: item.type,
      delivery: item.delivery,
      status: 'pending',
    })
  })
  .apply(inboxDelivered, async (event, state) => {
    const item = find(state, event.payload)
    if (item?.status === 'pending') item.status = 'delivered'
  })
  .apply(inboxCancelled, async (event, state) => {
    const item = find(state, event.payload)
    if (item?.status === 'pending') item.status = 'cancelled'
  })
  .apply(inboxDeliveryChanged, async (event, state) => {
    const payload = event.payload
    const item = find(state, payload)
    if (item?.status === 'pending') item.delivery = payload.delivery
  })
  .handle(async (query, state) => {
    const pending = (state.sessions[query.sessionID] ?? []).filter(
      (item) => item.status === 'pending',
    )
    const first = pending[0]
    if (!first) return { item: null, reason: 'nothing-pending' }

    // Steers deliver in enqueue order at either boundary, up to the first
    // queued control item, which nothing behind it may cross.
    for (const item of pending) {
      if (item.delivery === 'steer') return deliverable(item, 'steer-in-order')
      if (controlTypes.has(item.type)) break
    }

    if (query.boundary === 'idle')
      // The earliest queued item is at or before any control boundary.
      return deliverable(
        pending.find((item) => item.delivery === 'queue') ?? first,
        'idle-queued',
      )

    // A steer behind a queued control item is blocked by it.
    const control = pending.findIndex(
      (item) => item.delivery === 'queue' && controlTypes.has(item.type),
    )
    return control >= 0 &&
      pending.slice(control + 1).some((item) => item.delivery === 'steer')
      ? { item: null, reason: 'blocked-by-control-boundary' }
      : { item: null, reason: 'queue-waits-for-idle' }
  })

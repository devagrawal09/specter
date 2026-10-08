import { createQuerySlice, event, type JsonValue } from '@specter-ts/spec'

type JsonObject = { readonly [key: string]: JsonValue }

// Pure fold over a session's inbox events (session.md, "Prompt Admission
// Precedes Execution"). Pending = enqueued, not delivered, not cancelled; the
// latest `session.inbox.delivery.changed` wins; order is enqueue order.
// At a "step" boundary only steers deliver. At an "idle" boundary steers still
// take priority, otherwise the earliest queued item delivers. A pending
// compaction/move control item is a boundary: later items never cross it.
const user = (text: string, delivery: 'steer' | 'queue') => ({
  type: 'user',
  payload: { text },
  delivery,
})
const compaction = (delivery: 'steer' | 'queue') => ({
  type: 'compaction',
  payload: {},
  delivery,
})
const move = (delivery: 'steer' | 'queue') => ({
  type: 'move',
  payload: { location: { type: 'local' }, projectID: 'prj_1' },
  delivery,
})
const enqueued = (inboxID: string, item: JsonObject) =>
  event('session-inbox-enqueued', { sessionID: 'ses_1', inboxID, item })
const delivered = (inboxID: string) =>
  event('session-inbox-delivered', { sessionID: 'ses_1', inboxID })
const cancelled = (inboxID: string) =>
  event('session-inbox-cancelled', { sessionID: 'ses_1', inboxID })
const changed = (inboxID: string, delivery: 'steer' | 'queue') =>
  event('session-inbox-delivery-changed', { sessionID: 'ses_1', inboxID, delivery })

export const nextDeliverableSpec = createQuerySlice('nextDeliverable')
  .description(
    'Returns the inbox item that delivers next at a step or idle boundary, and why.',
  )
  .scenarios(
    {
      description:
        'An inbox item remains pending outside history until delivery: an empty inbox has nothing deliverable.',
      given: [],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: { item: null, reason: 'nothing-pending' },
    },
    {
      description:
        'A steer delivers at the next Safe Step Boundary.',
      given: [enqueued('inb_1', user('Fix it', 'steer'))],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'inb_1', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description: 'Steers deliver in enqueue order.',
      given: [
        enqueued('inb_1', user('First', 'steer')),
        enqueued('inb_2', user('Second', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'inb_1', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'Steers deliver in enqueue order: once the first is delivered the second is next.',
      given: [
        enqueued('inb_1', user('First', 'steer')),
        enqueued('inb_2', user('Second', 'steer')),
        delivered('inb_1'),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'inb_2', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'A queue item remains pending while the Session can continue (step boundary).',
      given: [enqueued('inb_1', user('Later', 'queue'))],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: { item: null, reason: 'queue-waits-for-idle' },
    },
    {
      description:
        'A queue item remains pending while the Session can continue: a later steer still delivers at a step boundary.',
      given: [
        enqueued('inb_1', user('Later', 'queue')),
        enqueued('inb_2', user('Now', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'inb_2', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'At an idle boundary, steers still take priority over an earlier queue item.',
      given: [
        enqueued('inb_1', user('Later', 'queue')),
        enqueued('inb_2', user('Now', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'idle' },
      expect: {
        item: { inboxID: 'inb_2', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'At an idle boundary with no steers, one queued item delivers (the earliest).',
      given: [
        enqueued('inb_1', user('Later', 'queue')),
        enqueued('inb_2', user('Even later', 'queue')),
      ],
      when: { sessionID: 'ses_1', boundary: 'idle' },
      expect: {
        item: { inboxID: 'inb_1', type: 'user', delivery: 'queue' },
        reason: 'idle-queued',
      },
    },
    {
      description:
        'After a queued item delivers, steers that arrived during delivery are followed before another queued item.',
      given: [
        enqueued('inb_1', user('Later', 'queue')),
        enqueued('inb_2', user('Even later', 'queue')),
        delivered('inb_1'),
        enqueued('inb_3', user('Arrived during delivery', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'idle' },
      expect: {
        item: { inboxID: 'inb_3', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'After the arrived steers deliver, the next queued item delivers at the idle boundary.',
      given: [
        enqueued('inb_1', user('Later', 'queue')),
        enqueued('inb_2', user('Even later', 'queue')),
        delivered('inb_1'),
        enqueued('inb_3', user('Arrived during delivery', 'steer')),
        delivered('inb_3'),
      ],
      when: { sessionID: 'ses_1', boundary: 'idle' },
      expect: {
        item: { inboxID: 'inb_2', type: 'user', delivery: 'queue' },
        reason: 'idle-queued',
      },
    },
    {
      description:
        'Delivery stops before a compaction or move control item: a steer behind a compaction does not cross it.',
      given: [
        enqueued('inb_1', compaction('queue')),
        enqueued('inb_2', user('After compaction', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: { item: null, reason: 'blocked-by-control-boundary' },
    },
    {
      description:
        'Delivery stops before a compaction or move control item: a steer behind a move does not cross it.',
      given: [
        enqueued('inb_1', move('queue')),
        enqueued('inb_2', user('After move', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: { item: null, reason: 'blocked-by-control-boundary' },
    },
    {
      description:
        'Steers ahead of a control item deliver first; the control item forms a boundary for later steers.',
      given: [
        enqueued('inb_1', user('Before compaction', 'steer')),
        enqueued('inb_2', compaction('steer')),
        enqueued('inb_3', user('After compaction', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'inb_1', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'A control item forms a delivery boundary so later steers do not cross it: with a steer control item at the head it delivers alone before later steers.',
      given: [
        enqueued('inb_1', compaction('steer')),
        enqueued('inb_2', user('After compaction', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'inb_1', type: 'compaction', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'A queued control item is the next idle delivery even when a later steer is pending: steers do not cross it.',
      given: [
        enqueued('inb_1', move('queue')),
        enqueued('inb_2', user('After move', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'idle' },
      expect: {
        item: { inboxID: 'inb_1', type: 'move', delivery: 'queue' },
        reason: 'idle-queued',
      },
    },
    {
      description:
        'Each request has its own delivery mode: changing a queued item to steer makes it deliverable at a step boundary.',
      given: [
        enqueued('inb_1', user('Later', 'queue')),
        changed('inb_1', 'steer'),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'inb_1', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'Cancelled items never deliver.',
      given: [
        enqueued('inb_1', user('Oops', 'steer')),
        cancelled('inb_1'),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: { item: null, reason: 'nothing-pending' },
    },
    {
      description:
        'A cancelled control item no longer forms a boundary.',
      given: [
        enqueued('inb_1', compaction('queue')),
        enqueued('inb_2', user('After compaction', 'steer')),
        cancelled('inb_1'),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'inb_2', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'Delivered items never deliver twice.',
      given: [
        enqueued('inb_1', user('Once', 'steer')),
        delivered('inb_1'),
      ],
      when: { sessionID: 'ses_1', boundary: 'idle' },
      expect: { item: null, reason: 'nothing-pending' },
    },
  )

export default nextDeliverableSpec

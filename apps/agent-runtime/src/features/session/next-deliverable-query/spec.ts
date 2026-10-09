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
  payload: { location: { directory: '/tmp/ws' }, projectID: 'prj_1' },
  delivery,
})
const enqueued = (inboxID: string, item: JsonObject) =>
  event('session-inbox-enqueued', { sessionID: 'ses_1', inboxID, item })
const delivered = (inboxID: string) =>
  event('session-inbox-delivered', { sessionID: 'ses_1', inboxID })
const cancelled = (inboxID: string) =>
  event('session-inbox-cancelled', { sessionID: 'ses_1', inboxID })
const changed = (inboxID: string, delivery: 'steer' | 'queue') =>
  event('session-inbox-delivery-changed', {
    sessionID: 'ses_1',
    inboxID,
    delivery,
  })

export const nextDeliverableSpec = createQuerySlice('nextDeliverable')
  .description(
    'Returns the inbox item that delivers next at a step or idle boundary, and why.',
  )
  .scenarios(
    {
      description:
        "At an entry (a continued turn's rest point, or a new Location's), the queue's head goes in when it is a control item.",
      given: [
        enqueued('msg_1', compaction('queue')),
        enqueued('msg_2', user('Later', 'queue')),
      ],
      when: { sessionID: 'ses_1', boundary: 'entry' },
      expect: {
        item: { inboxID: 'msg_1', type: 'compaction', delivery: 'queue' },
        reason: 'entry-control',
      },
    },
    {
      description:
        'At an entry, queued input at the head of the queue waits for an idle boundary, and so does a control item behind it.',
      given: [
        enqueued('msg_1', user('Later', 'queue')),
        enqueued('msg_2', compaction('queue')),
      ],
      when: { sessionID: 'ses_1', boundary: 'entry' },
      expect: { item: null, reason: 'queue-waits-for-idle' },
    },
    {
      description:
        'At an entry, steers deliver before a queued control item, in enqueue order.',
      given: [
        enqueued('msg_1', compaction('queue')),
        enqueued('msg_2', user('Now', 'steer')),
        enqueued('msg_3', user('Then', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'entry' },
      expect: {
        item: { inboxID: 'msg_2', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'An inbox item remains pending outside history until delivery: an empty inbox has nothing deliverable.',
      given: [],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: { item: null, reason: 'nothing-pending' },
    },
    {
      description: 'A steer delivers at the next Safe Step Boundary.',
      given: [enqueued('msg_1', user('Fix it', 'steer'))],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'msg_1', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description: 'Steers deliver in enqueue order.',
      given: [
        enqueued('msg_1', user('First', 'steer')),
        enqueued('msg_2', user('Second', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'msg_1', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'Steers deliver in enqueue order: once the first is delivered the second is next.',
      given: [
        enqueued('msg_1', user('First', 'steer')),
        enqueued('msg_2', user('Second', 'steer')),
        delivered('msg_1'),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'msg_2', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'A queue item remains pending while the Session can continue (step boundary).',
      given: [enqueued('msg_1', user('Later', 'queue'))],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: { item: null, reason: 'queue-waits-for-idle' },
    },
    {
      description:
        'A queue item remains pending while the Session can continue: a later steer still delivers at a step boundary.',
      given: [
        enqueued('msg_1', user('Later', 'queue')),
        enqueued('msg_2', user('Now', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'msg_2', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'At an idle boundary, steers still take priority over an earlier queue item.',
      given: [
        enqueued('msg_1', user('Later', 'queue')),
        enqueued('msg_2', user('Now', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'idle' },
      expect: {
        item: { inboxID: 'msg_2', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'At an idle boundary with no steers, one queued item delivers (the earliest).',
      given: [
        enqueued('msg_1', user('Later', 'queue')),
        enqueued('msg_2', user('Even later', 'queue')),
      ],
      when: { sessionID: 'ses_1', boundary: 'idle' },
      expect: {
        item: { inboxID: 'msg_1', type: 'user', delivery: 'queue' },
        reason: 'idle-queued',
      },
    },
    {
      description:
        'After a queued item delivers, steers that arrived during delivery are followed before another queued item.',
      given: [
        enqueued('msg_1', user('Later', 'queue')),
        enqueued('msg_2', user('Even later', 'queue')),
        delivered('msg_1'),
        enqueued('msg_3', user('Arrived during delivery', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'idle' },
      expect: {
        item: { inboxID: 'msg_3', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'After the arrived steers deliver, the next queued item delivers at the idle boundary.',
      given: [
        enqueued('msg_1', user('Later', 'queue')),
        enqueued('msg_2', user('Even later', 'queue')),
        delivered('msg_1'),
        enqueued('msg_3', user('Arrived during delivery', 'steer')),
        delivered('msg_3'),
      ],
      when: { sessionID: 'ses_1', boundary: 'idle' },
      expect: {
        item: { inboxID: 'msg_2', type: 'user', delivery: 'queue' },
        reason: 'idle-queued',
      },
    },
    {
      description:
        'Steering delivery is among steers: a queued compaction does not hold back a steer enqueued after it.',
      given: [
        enqueued('msg_1', compaction('queue')),
        enqueued('msg_2', user('After compaction', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'msg_2', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'A queued move does not hold back a later steer either; it waits for an idle boundary or an entry.',
      given: [
        enqueued('msg_1', move('queue')),
        enqueued('msg_2', user('After move', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'msg_2', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'Steers ahead of a control item deliver first; the control item forms a boundary for later steers.',
      given: [
        enqueued('msg_1', user('Before compaction', 'steer')),
        enqueued('msg_2', compaction('steer')),
        enqueued('msg_3', user('After compaction', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'msg_1', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'A control item forms a delivery boundary so later steers do not cross it: with a steer control item at the head it delivers alone before later steers.',
      given: [
        enqueued('msg_1', compaction('steer')),
        enqueued('msg_2', user('After compaction', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'msg_1', type: 'compaction', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'At an idle boundary steers take priority over a queued control item.',
      given: [
        enqueued('msg_1', move('queue')),
        enqueued('msg_2', user('After move', 'steer')),
      ],
      when: { sessionID: 'ses_1', boundary: 'idle' },
      expect: {
        item: { inboxID: 'msg_2', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description:
        'With no steer pending, a queued control item is the next idle delivery.',
      given: [
        enqueued('msg_1', move('queue')),
        enqueued('msg_2', user('After move', 'queue')),
      ],
      when: { sessionID: 'ses_1', boundary: 'idle' },
      expect: {
        item: { inboxID: 'msg_1', type: 'move', delivery: 'queue' },
        reason: 'idle-queued',
      },
    },
    {
      description:
        'Each request has its own delivery mode: changing a queued item to steer makes it deliverable at a step boundary.',
      given: [
        enqueued('msg_1', user('Later', 'queue')),
        changed('msg_1', 'steer'),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'msg_1', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description: 'Cancelled items never deliver.',
      given: [enqueued('msg_1', user('Oops', 'steer')), cancelled('msg_1')],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: { item: null, reason: 'nothing-pending' },
    },
    {
      description: 'A cancelled control item no longer forms a boundary.',
      given: [
        enqueued('msg_1', compaction('queue')),
        enqueued('msg_2', user('After compaction', 'steer')),
        cancelled('msg_1'),
      ],
      when: { sessionID: 'ses_1', boundary: 'step' },
      expect: {
        item: { inboxID: 'msg_2', type: 'user', delivery: 'steer' },
        reason: 'steer-in-order',
      },
    },
    {
      description: 'Delivered items never deliver twice.',
      given: [enqueued('msg_1', user('Once', 'steer')), delivered('msg_1')],
      when: { sessionID: 'ses_1', boundary: 'idle' },
      expect: { item: null, reason: 'nothing-pending' },
    },
  )

export default nextDeliverableSpec

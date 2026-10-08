import { createCommandSlice, event } from '@specter-ts/spec'

const created = event('session-created', {
  sessionID: 'ses_1',
  projectID: 'prj_1',
  location: { directory: '/tmp/ws' },
  slug: 'brave-otter',
  version: '2',
})

const started = (sessionID = 'ses_1') =>
  event('session-execution-started', { sessionID })

const enqueued = (inboxID: string, sessionID = 'ses_1') =>
  event('session-inbox-enqueued', {
    sessionID,
    inboxID,
    item: { type: 'user', payload: { text: 'hello' }, delivery: 'steer' },
  })

const ref = (inboxID: string, sessionID = 'ses_1') => ({ sessionID, inboxID })

export const deliverInboxItemSpec = createCommandSlice('deliverInboxItem')
  .description(
    'Delivers a pending inbox item into Session History (session.md: Prompt Admission Precedes Execution).',
  )
  .scenarios(
    {
      description:
        'The session.inbox.delivered projection consumes the pending row: a pending item is delivered.',
      given: [created, started(), enqueued('msg_1')],
      when: ref('msg_1'),
      expect: [event('session-inbox-delivered', ref('msg_1'))],
    },
    {
      description:
        'Delivery consumes one item at a time: a second pending item stays deliverable after the first is delivered.',
      given: [
        created,
        started(),
        enqueued('msg_1'),
        enqueued('msg_2'),
        event('session-inbox-delivered', ref('msg_1')),
      ],
      when: ref('msg_2'),
      expect: [event('session-inbox-delivered', ref('msg_2'))],
    },
    {
      description:
        'The projection consumed the row, so an already delivered item cannot be delivered again.',
      given: [
        created,
        started(),
        enqueued('msg_1'),
        event('session-inbox-delivered', ref('msg_1')),
      ],
      when: ref('msg_1'),
      expect: [],
      reject: { reason: 'Inbox item already delivered' },
    },
    {
      description: 'A cancelled item never becomes visible history.',
      given: [
        created,
        started(),
        enqueued('msg_1'),
        event('session-inbox-cancelled', ref('msg_1')),
      ],
      when: ref('msg_1'),
      expect: [],
      reject: { reason: 'Inbox item already cancelled' },
    },
    {
      description: 'An inbox item that was never admitted cannot be delivered.',
      given: [created, started()],
      when: ref('msg_missing'),
      expect: [],
      reject: { reason: 'Inbox item not found' },
    },
    {
      description:
        'Cross-Session reuse fails: an item owned by another Session is not found in this one.',
      given: [
        created,
        event('session-created', {
          sessionID: 'ses_2',
          projectID: 'prj_1',
          location: { directory: '/tmp/ws' },
          slug: 'calm-heron',
          version: '2',
        }),
        started('ses_2'),
        enqueued('msg_1'),
      ],
      when: ref('msg_1', 'ses_2'),
      expect: [],
      reject: { reason: 'Inbox item not found' },
    },
    {
      description:
        'Delivery requires an active execution: with no execution started, a pending item cannot be delivered.',
      given: [created, enqueued('msg_1')],
      when: ref('msg_1'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'Delivery requires an active execution: after the execution was interrupted, a still-pending item cannot be delivered.',
      given: [
        created,
        started(),
        enqueued('msg_1'),
        event('session-execution-interrupted', {
          sessionID: 'ses_1',
          reason: 'user',
        }),
      ],
      when: ref('msg_1'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'Delivery requires an active execution: after the execution succeeded, a still-pending item cannot be delivered.',
      given: [
        created,
        started(),
        enqueued('msg_1'),
        event('session-execution-succeeded', { sessionID: 'ses_1' }),
      ],
      when: ref('msg_1'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'Delivery requires an active execution: after the execution failed, a still-pending item cannot be delivered.',
      given: [
        created,
        started(),
        enqueued('msg_1'),
        event('session-execution-failed', {
          sessionID: 'ses_1',
          error: { type: 'provider', message: 'boom' },
        }),
      ],
      when: ref('msg_1'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'Delivery to an unknown Session fails.',
      given: [],
      when: ref('msg_1', 'ses_missing'),
      expect: [],
      reject: { reason: 'Session not found' },
    },
  )

export default deliverInboxItemSpec

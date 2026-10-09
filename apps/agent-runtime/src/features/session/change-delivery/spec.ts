import { createCommandSlice, event } from '@specter-ts/spec'

const enqueued = (inboxID: string, delivery: string, sessionID = 'ses_1') =>
  event('session-inbox-enqueued', {
    sessionID,
    inboxID,
    item: { type: 'user', payload: { text: 'later' }, delivery },
  })
const changed = (inboxID: string, delivery: string) =>
  event('session-inbox-delivery-changed', {
    sessionID: 'ses_1',
    inboxID,
    delivery,
  })

export const changeDeliverySpec = createCommandSlice('changeDelivery')
  .description(
    'Changes how a pending inbox item is delivered (session.md: steer and queue): a steered item enters history at the next step boundary, a queued one waits for idle.',
  )
  .scenarios(
    {
      description: 'A queued item is steered.',
      given: [enqueued('msg_1', 'queue')],
      when: { sessionID: 'ses_1', inboxID: 'msg_1', delivery: 'steer' },
      expect: [changed('msg_1', 'steer')],
    },
    {
      description: 'A steered item is queued.',
      given: [enqueued('msg_1', 'steer')],
      when: { sessionID: 'ses_1', inboxID: 'msg_1', delivery: 'queue' },
      expect: [changed('msg_1', 'queue')],
    },
    {
      description: 'An item can change back after an earlier change.',
      given: [enqueued('msg_1', 'queue'), changed('msg_1', 'steer')],
      when: { sessionID: 'ses_1', inboxID: 'msg_1', delivery: 'queue' },
      expect: [changed('msg_1', 'queue')],
    },
    {
      description: 'An item already delivered that way is rejected.',
      given: [enqueued('msg_1', 'steer')],
      when: { sessionID: 'ses_1', inboxID: 'msg_1', delivery: 'steer' },
      expect: [],
      reject: { reason: 'Inbox item already steer' },
    },
    {
      description: 'Delivered input is no longer pending.',
      given: [
        enqueued('msg_1', 'queue'),
        event('session-inbox-delivered', {
          sessionID: 'ses_1',
          inboxID: 'msg_1',
        }),
      ],
      when: { sessionID: 'ses_1', inboxID: 'msg_1', delivery: 'steer' },
      expect: [],
      reject: { reason: 'Inbox item not pending' },
    },
    {
      description: 'Cancelled input is no longer pending.',
      given: [
        enqueued('msg_1', 'queue'),
        event('session-inbox-cancelled', {
          sessionID: 'ses_1',
          inboxID: 'msg_1',
        }),
      ],
      when: { sessionID: 'ses_1', inboxID: 'msg_1', delivery: 'steer' },
      expect: [],
      reject: { reason: 'Inbox item not pending' },
    },
    {
      description:
        'An unknown item, or one admitted to another Session, is not found.',
      given: [enqueued('msg_1', 'queue', 'ses_2')],
      when: { sessionID: 'ses_1', inboxID: 'msg_1', delivery: 'steer' },
      expect: [],
      reject: { reason: 'Inbox item not found' },
    },
  )

export default changeDeliverySpec

import { createCommandSlice, event } from '@specter-ts/spec'

const created = event('session-created', {
  sessionID: 'ses_1',
  projectID: 'prj_1',
  location: { type: 'local' },
  slug: 'brave-otter',
  version: '2',
})

const enqueued = event('session-inbox-enqueued', {
  sessionID: 'ses_1',
  inboxID: 'inb_1',
  item: { type: 'user', payload: { text: 'hello' }, delivery: 'queue' },
})

export const cancelInboxItemSpec = createCommandSlice('cancelInboxItem')
  .description(
    'Cancels a pending inbox item; cancellation never schedules execution (session.md: pending-input mutation).',
  )
  .scenarios(
    {
      description: 'Cancels an inbox item that is still pending.',
      given: [created, enqueued],
      when: { sessionID: 'ses_1', inboxID: 'inb_1' },
      expect: [
        event('session-inbox-cancelled', {
          sessionID: 'ses_1',
          inboxID: 'inb_1',
        }),
      ],
    },
    {
      description:
        'An item whose inbox row was consumed by delivery cannot be cancelled.',
      given: [
        created,
        enqueued,
        event('session-inbox-delivered', {
          sessionID: 'ses_1',
          inboxID: 'inb_1',
        }),
      ],
      when: { sessionID: 'ses_1', inboxID: 'inb_1' },
      expect: [],
      reject: { reason: 'Inbox item already delivered' },
    },
    {
      description: 'Cancelling an unknown inbox item fails.',
      given: [created],
      when: { sessionID: 'ses_1', inboxID: 'inb_missing' },
      expect: [],
      reject: { reason: 'Inbox item not found' },
    },
    {
      description: 'Cancelling in an unknown Session fails.',
      given: [],
      when: { sessionID: 'ses_missing', inboxID: 'inb_1' },
      expect: [],
      reject: { reason: 'Session not found' },
    },
  )

export default cancelInboxItemSpec

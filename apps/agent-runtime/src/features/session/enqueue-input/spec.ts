import { createCommandSlice, event } from '@specter-ts/spec'

const created = (sessionID: string) =>
  event('session-created', {
    sessionID,
    projectID: 'prj_1',
    location: { type: 'local' },
    slug: 'brave-otter',
    version: '2',
  })

const enqueued = (
  sessionID: string,
  inboxID: string,
  item: { type: string; payload: Record<string, string>; delivery: string },
) => event('session-inbox-enqueued', { sessionID, inboxID, item })

const userItem = (text: string, delivery = 'steer') => ({
  type: 'user',
  payload: { text },
  delivery,
})

export const enqueueInputSpec = createCommandSlice('enqueueInput')
  .description(
    'Admits a user or synthetic input to a Session inbox before execution begins (session.md: Prompt Admission Precedes Execution).',
  )
  .scenarios(
    {
      description:
        'Session.prompt publishes one durable session.inbox.enqueued fact; the input stays pending outside Session History until delivery.',
      given: [created('ses_1')],
      when: {
        sessionID: 'ses_1',
        inboxID: 'inb_1',
        type: 'user',
        payload: { text: 'Inspect the failing tests' },
      },
      expect: [
        enqueued('ses_1', 'inb_1', userItem('Inspect the failing tests')),
      ],
    },
    {
      description:
        'Delivery is explicit: steer is the default when delivery is omitted.',
      given: [created('ses_1')],
      when: {
        sessionID: 'ses_1',
        inboxID: 'inb_1',
        type: 'user',
        payload: { text: 'hello' },
      },
      expect: [enqueued('ses_1', 'inb_1', userItem('hello', 'steer'))],
    },
    {
      description: 'Delivery queue is recorded when requested.',
      given: [created('ses_1')],
      when: {
        sessionID: 'ses_1',
        inboxID: 'inb_1',
        type: 'user',
        payload: { text: 'later' },
        delivery: 'queue',
      },
      expect: [enqueued('ses_1', 'inb_1', userItem('later', 'queue'))],
    },
    {
      description:
        'Completion and startup-failure notifications are admitted as synthetic input.',
      given: [created('ses_1')],
      when: {
        sessionID: 'ses_1',
        inboxID: 'inb_2',
        type: 'synthetic',
        payload: { text: 'Shell command finished' },
        resume: false,
      },
      expect: [
        enqueued('ses_1', 'inb_2', {
          type: 'synthetic',
          payload: { text: 'Shell command finished' },
          delivery: 'steer',
        }),
      ],
    },
    {
      description:
        'resume controls scheduling, not durability: false records the input without scheduling execution.',
      given: [created('ses_1')],
      when: {
        sessionID: 'ses_1',
        inboxID: 'inb_1',
        type: 'user',
        payload: { text: 'record only' },
        resume: false,
      },
      expect: [enqueued('ses_1', 'inb_1', userItem('record only'))],
    },
    {
      description:
        'resume controls scheduling, not durability: omitted or true records the input, then schedules wake (wake is a reaction on session.inbox.enqueued; events.ts has no wake event).',
      given: [created('ses_1')],
      when: {
        sessionID: 'ses_1',
        inboxID: 'inb_1',
        type: 'user',
        payload: { text: 'record and wake' },
        resume: true,
      },
      expect: [enqueued('ses_1', 'inb_1', userItem('record and wake'))],
    },
    {
      description:
        'Reusing a Session ID adopts the existing Session: a second input to the same Session is admitted.',
      given: [
        created('ses_1'),
        enqueued('ses_1', 'inb_1', userItem('first')),
      ],
      when: {
        sessionID: 'ses_1',
        inboxID: 'inb_2',
        type: 'user',
        payload: { text: 'second' },
      },
      expect: [enqueued('ses_1', 'inb_2', userItem('second'))],
    },
    // NOT EXPRESSIBLE (Specter validation: empty `expect` requires `reject`):
    // - Reusing a user inbox item ID is idempotent when Session and type match:
    //   first admission wins; retried payload, metadata, delivery are ignored.
    // - Same for a synthetic inbox item ID.
    // - After delivery, retry reconciliation uses the projected message and does
    //   not require enqueue history.
    // Each must emit no event; add scenarios once Specter supports no-op results.
    {
      description:
        'Cross-type reuse fails: an existing inbox item ID cannot be reused with a different type.',
      given: [
        created('ses_1'),
        enqueued('ses_1', 'inb_1', userItem('first')),
      ],
      when: {
        sessionID: 'ses_1',
        inboxID: 'inb_1',
        type: 'synthetic',
        payload: { text: 'not a user prompt' },
      },
      expect: [],
      reject: { reason: 'Inbox item type does not match existing item' },
    },
    {
      description:
        'Cross-Session reuse fails: an inbox item ID owned by another Session cannot be admitted.',
      given: [
        created('ses_1'),
        created('ses_2'),
        enqueued('ses_1', 'inb_1', userItem('first')),
      ],
      when: {
        sessionID: 'ses_2',
        inboxID: 'inb_1',
        type: 'user',
        payload: { text: 'steal' },
      },
      expect: [],
      reject: { reason: 'Inbox item belongs to a different session' },
    },
    {
      description: 'Admission to an unknown Session fails.',
      given: [],
      when: {
        sessionID: 'ses_missing',
        inboxID: 'inb_1',
        type: 'user',
        payload: { text: 'hello' },
      },
      expect: [],
      reject: { reason: 'Session not found' },
    },
  )

export default enqueueInputSpec

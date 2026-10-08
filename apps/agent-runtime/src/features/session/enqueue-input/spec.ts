import { createCommandSlice, event } from '@specter-ts/spec'

const created = (sessionID: string) =>
  event('session-created', {
    sessionID,
    projectID: 'prj_1',
    location: { directory: '/tmp/ws' },
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
        inboxID: 'msg_1',
        type: 'user',
        payload: { text: 'Inspect the failing tests' },
      },
      expect: [
        enqueued('ses_1', 'msg_1', userItem('Inspect the failing tests')),
      ],
    },
    {
      description:
        'Delivery is explicit: steer is the default when delivery is omitted.',
      given: [created('ses_1')],
      when: {
        sessionID: 'ses_1',
        inboxID: 'msg_1',
        type: 'user',
        payload: { text: 'hello' },
      },
      expect: [enqueued('ses_1', 'msg_1', userItem('hello', 'steer'))],
    },
    {
      description: 'Delivery queue is recorded when requested.',
      given: [created('ses_1')],
      when: {
        sessionID: 'ses_1',
        inboxID: 'msg_1',
        type: 'user',
        payload: { text: 'later' },
        delivery: 'queue',
      },
      expect: [enqueued('ses_1', 'msg_1', userItem('later', 'queue'))],
    },
    {
      description:
        'Completion and startup-failure notifications are admitted as synthetic input.',
      given: [created('ses_1')],
      when: {
        sessionID: 'ses_1',
        inboxID: 'msg_2',
        type: 'synthetic',
        payload: { text: 'Shell command finished' },
        resume: false,
      },
      expect: [
        enqueued('ses_1', 'msg_2', {
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
        inboxID: 'msg_1',
        type: 'user',
        payload: { text: 'record only' },
        resume: false,
      },
      expect: [enqueued('ses_1', 'msg_1', userItem('record only'))],
    },
    {
      description:
        'resume controls scheduling, not durability: omitted or true records the input, then schedules wake (wake is a reaction on session.inbox.enqueued; events.ts has no wake event).',
      given: [created('ses_1')],
      when: {
        sessionID: 'ses_1',
        inboxID: 'msg_1',
        type: 'user',
        payload: { text: 'record and wake' },
        resume: true,
      },
      expect: [enqueued('ses_1', 'msg_1', userItem('record and wake'))],
    },
    {
      description:
        'Reusing a Session ID adopts the existing Session: a second input to the same Session is admitted.',
      given: [created('ses_1'), enqueued('ses_1', 'msg_1', userItem('first'))],
      when: {
        sessionID: 'ses_1',
        inboxID: 'msg_2',
        type: 'user',
        payload: { text: 'second' },
      },
      expect: [enqueued('ses_1', 'msg_2', userItem('second'))],
    },
    {
      description:
        'Reusing a user inbox item ID for the same Session and type is rejected as already admitted.',
      given: [created('ses_1'), enqueued('ses_1', 'msg_1', userItem('first'))],
      when: {
        sessionID: 'ses_1',
        inboxID: 'msg_1',
        type: 'user',
        payload: { text: 'retry' },
      },
      expect: [],
      reject: { reason: 'Inbox item already admitted' },
    },
    {
      description:
        'Reusing a synthetic inbox item ID for the same Session and type is rejected as already admitted.',
      given: [
        created('ses_1'),
        enqueued('ses_1', 'msg_2', {
          type: 'synthetic',
          payload: { text: 'Shell command finished' },
          delivery: 'steer',
        }),
      ],
      when: {
        sessionID: 'ses_1',
        inboxID: 'msg_2',
        type: 'synthetic',
        payload: { text: 'Shell command finished' },
      },
      expect: [],
      reject: { reason: 'Inbox item already admitted' },
    },
    {
      description:
        'Cross-type reuse fails: an existing inbox item ID cannot be reused with a different type.',
      given: [created('ses_1'), enqueued('ses_1', 'msg_1', userItem('first'))],
      when: {
        sessionID: 'ses_1',
        inboxID: 'msg_1',
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
        enqueued('ses_1', 'msg_1', userItem('first')),
      ],
      when: {
        sessionID: 'ses_2',
        inboxID: 'msg_1',
        type: 'user',
        payload: { text: 'steal' },
      },
      expect: [],
      reject: { reason: 'Inbox item belongs to a different session' },
    },
    {
      description:
        'Admission after a committed revert works normally: the revert changes history, not the inbox.',
      given: [
        created('ses_1'),
        event('session-revert-committed', { sessionID: 'ses_1', to: 'msg_1' }),
      ],
      when: {
        sessionID: 'ses_1',
        inboxID: 'msg_2',
        type: 'user',
        payload: { text: 'try again' },
      },
      expect: [enqueued('ses_1', 'msg_2', userItem('try again'))],
    },
    {
      description: 'Admission to an unknown Session fails.',
      given: [],
      when: {
        sessionID: 'ses_missing',
        inboxID: 'msg_1',
        type: 'user',
        payload: { text: 'hello' },
      },
      expect: [],
      reject: { reason: 'Session not found' },
    },
  )

export default enqueueInputSpec

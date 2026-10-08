import { createQuerySlice, event } from '@specter-ts/spec'

// Fork as a projection (plan decision): on session.forked the child's history
// is a frozen copy of the parent's messages up to the boundary; the child's own
// messages follow. Each item names the Session that recorded it. Rebuildable
// from the Event Log; no log fork.
const created = (sessionID: string) =>
  event('session-created', {
    sessionID,
    projectID: 'prj_1',
    location: { directory: '/tmp/ws' },
    slug: 'brave-otter',
    version: '2',
  })
const enqueued = (inboxID: string, sessionID = 'ses_1', synthetic = false) =>
  event('session-inbox-enqueued', {
    sessionID,
    inboxID,
    item: synthetic
      ? { type: 'synthetic', payload: { text: 'note' }, delivery: 'steer' }
      : { type: 'user', payload: { text: 'hello' }, delivery: 'steer' },
  })
const delivered = (inboxID: string, sessionID = 'ses_1') =>
  event('session-inbox-delivered', { sessionID, inboxID })
const stepStarted = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-started', {
    sessionID,
    assistantMessageID,
    agent: 'build',
    model: { id: 'scripted', providerID: 'test' },
  })
const stepEnded = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-ended', {
    sessionID,
    assistantMessageID,
    finish: 'stop',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
const stepFailed = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-failed', {
    sessionID,
    assistantMessageID,
    error: { type: 'transport', message: 'connection reset' },
  })
const forked = (
  sessionID: string,
  parentID: string,
  type: 'before' | 'through',
  messageID: string,
) =>
  event('session-forked', {
    sessionID,
    parentID,
    boundary: { type, messageID },
  })
const staged = (messageID: string, sessionID = 'ses_1') =>
  event('session-revert-staged', { sessionID, revert: { messageID } })
const committed = (to: string, sessionID = 'ses_1') =>
  event('session-revert-committed', { sessionID, to })
const user = (messageID: string, sessionID = 'ses_1') => ({
  messageID,
  sessionID,
  type: 'user',
})
const assistant = (messageID: string, status: string, sessionID = 'ses_1') => ({
  messageID,
  sessionID,
  type: 'assistant',
  status,
})

// ses_1: msg_1 (user), msg_2 (assistant, ended), msg_3 (user).
const parentHistory = [
  created('ses_1'),
  created('ses_2'),
  enqueued('msg_1'),
  delivered('msg_1'),
  stepStarted('msg_2'),
  stepEnded('msg_2'),
  enqueued('msg_3'),
  delivered('msg_3'),
]

export const sessionHistorySpec = createQuerySlice('sessionHistory')
  .description(
    'Lists a Session history in order: delivered inbox items and assistant messages, including the parent messages a fork copied up to its boundary.',
  )
  .scenarios(
    {
      description: 'A Session with no events has an empty history.',
      given: [],
      when: { sessionID: 'ses_1' },
      expect: { items: [] },
    },
    {
      description: 'A pending inbox item is not history until it is delivered.',
      given: [created('ses_1'), enqueued('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: { items: [] },
    },
    {
      description:
        'Delivered items and step messages appear in the order they entered history.',
      given: parentHistory,
      when: { sessionID: 'ses_1' },
      expect: {
        items: [user('msg_1'), assistant('msg_2', 'ended'), user('msg_3')],
      },
    },
    {
      description: 'A delivered synthetic item keeps its type.',
      given: [
        created('ses_1'),
        enqueued('msg_1', 'ses_1', true),
        delivered('msg_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        items: [{ messageID: 'msg_1', sessionID: 'ses_1', type: 'synthetic' }],
      },
    },
    {
      description:
        'A retried step stays one message, at its first position, with its latest status.',
      given: [
        created('ses_1'),
        stepStarted('msg_2'),
        stepFailed('msg_2'),
        stepStarted('msg_2'),
      ],
      when: { sessionID: 'ses_1' },
      expect: { items: [assistant('msg_2', 'started')] },
    },
    {
      description: 'A failed step message reports failed.',
      given: [created('ses_1'), stepStarted('msg_2'), stepFailed('msg_2')],
      when: { sessionID: 'ses_1' },
      expect: { items: [assistant('msg_2', 'failed')] },
    },
    {
      description: 'Sessions are independent.',
      given: [
        created('ses_1'),
        created('ses_2'),
        enqueued('msg_1'),
        delivered('msg_1'),
      ],
      when: { sessionID: 'ses_2' },
      expect: { items: [] },
    },
    {
      description:
        'A fork through a message copies the parent history up to and including it.',
      given: [...parentHistory, forked('ses_2', 'ses_1', 'through', 'msg_2')],
      when: { sessionID: 'ses_2' },
      expect: { items: [user('msg_1'), assistant('msg_2', 'ended')] },
    },
    {
      description:
        'A fork before a message copies the parent history up to, not including, it.',
      given: [...parentHistory, forked('ses_2', 'ses_1', 'before', 'msg_2')],
      when: { sessionID: 'ses_2' },
      expect: { items: [user('msg_1')] },
    },
    {
      description: 'A fork before the first message starts empty.',
      given: [...parentHistory, forked('ses_2', 'ses_1', 'before', 'msg_1')],
      when: { sessionID: 'ses_2' },
      expect: { items: [] },
    },
    {
      description:
        'The child appends its own messages after the copied ones; the parent is unchanged.',
      given: [
        ...parentHistory,
        forked('ses_2', 'ses_1', 'through', 'msg_1'),
        enqueued('msg_8', 'ses_2'),
        delivered('msg_8', 'ses_2'),
      ],
      when: { sessionID: 'ses_2' },
      expect: { items: [user('msg_1'), user('msg_8', 'ses_2')] },
    },
    {
      description:
        'Parent messages after the fork are not copied into the child, and the parent keeps growing.',
      given: [
        ...parentHistory,
        forked('ses_2', 'ses_1', 'through', 'msg_1'),
        enqueued('msg_4'),
        delivered('msg_4'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        items: [
          user('msg_1'),
          assistant('msg_2', 'ended'),
          user('msg_3'),
          user('msg_4'),
        ],
      },
    },
    {
      description:
        'The copy is frozen at the fork: a later parent update of a copied message does not change the child.',
      given: [
        created('ses_1'),
        created('ses_2'),
        stepStarted('msg_2'),
        forked('ses_2', 'ses_1', 'through', 'msg_2'),
        stepEnded('msg_2'),
      ],
      when: { sessionID: 'ses_2' },
      expect: { items: [assistant('msg_2', 'started')] },
    },
    {
      description:
        'A fork of a fork carries the grandparent messages the middle Session copied.',
      given: [
        ...parentHistory,
        created('ses_3'),
        forked('ses_2', 'ses_1', 'through', 'msg_2'),
        forked('ses_3', 'ses_2', 'through', 'msg_2'),
      ],
      when: { sessionID: 'ses_3' },
      expect: { items: [user('msg_1'), assistant('msg_2', 'ended')] },
    },
    {
      description: 'A staged (uncommitted) revert does not change history.',
      given: [...parentHistory, staged('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: {
        items: [user('msg_1'), assistant('msg_2', 'ended'), user('msg_3')],
      },
    },
    {
      description:
        'A committed revert ends history at the boundary message, inclusive (projection only; the Event Log is untouched).',
      given: [...parentHistory, staged('msg_1'), committed('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: { items: [user('msg_1')] },
    },
    {
      description: 'An assistant message is a valid commit boundary.',
      given: [...parentHistory, staged('msg_2'), committed('msg_2')],
      when: { sessionID: 'ses_1' },
      expect: { items: [user('msg_1'), assistant('msg_2', 'ended')] },
    },
    {
      description:
        'Messages recorded after a committed revert append after the boundary.',
      given: [
        ...parentHistory,
        staged('msg_1'),
        committed('msg_1'),
        enqueued('msg_4'),
        delivered('msg_4'),
      ],
      when: { sessionID: 'ses_1' },
      expect: { items: [user('msg_1'), user('msg_4')] },
    },
    {
      description:
        'Pending inbox items are untouched by a commit (revert.ts does not mention them): one enqueued before the commit is still delivered into the reverted history afterwards.',
      given: [
        ...parentHistory,
        enqueued('msg_4'),
        staged('msg_1'),
        committed('msg_1'),
        delivered('msg_4'),
      ],
      when: { sessionID: 'ses_1' },
      expect: { items: [user('msg_1'), user('msg_4')] },
    },
    {
      description:
        'A second commit at an earlier boundary shortens history again.',
      given: [
        ...parentHistory,
        staged('msg_2'),
        committed('msg_2'),
        staged('msg_1'),
        committed('msg_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: { items: [user('msg_1')] },
    },
    {
      description: 'A commit reverts only its own Session.',
      given: [
        ...parentHistory,
        enqueued('msg_9', 'ses_2'),
        delivered('msg_9', 'ses_2'),
        staged('msg_1'),
        committed('msg_1'),
      ],
      when: { sessionID: 'ses_2' },
      expect: { items: [user('msg_9', 'ses_2')] },
    },
    {
      description:
        'A fork after a committed revert copies only the post-revert history.',
      given: [
        ...parentHistory,
        staged('msg_2'),
        committed('msg_2'),
        forked('ses_2', 'ses_1', 'through', 'msg_2'),
      ],
      when: { sessionID: 'ses_2' },
      expect: { items: [user('msg_1'), assistant('msg_2', 'ended')] },
    },
    {
      description:
        'A fork taken before a commit is a frozen copy: reverting the parent later does not change the child.',
      given: [
        ...parentHistory,
        forked('ses_2', 'ses_1', 'through', 'msg_3'),
        staged('msg_1'),
        committed('msg_1'),
      ],
      when: { sessionID: 'ses_2' },
      expect: {
        items: [user('msg_1'), assistant('msg_2', 'ended'), user('msg_3')],
      },
    },
  )

export default sessionHistorySpec

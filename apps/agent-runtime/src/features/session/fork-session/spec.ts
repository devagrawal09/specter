import { createCommandSlice, event } from '@specter-ts/spec'

// A fork is a projection (plan decision): the Command emits session.forked on
// the child and the history projection copies the parent's messages up to the
// boundary. There is no Event Log fork. Instruction baselines and revert are
// not modelled.
const created = (sessionID: string) =>
  event('session-created', {
    sessionID,
    projectID: 'prj_1',
    location: { directory: '/tmp/ws' },
    slug: 'brave-otter',
    version: '2',
  })
const enqueued = (inboxID: string, sessionID = 'ses_1') =>
  event('session-inbox-enqueued', {
    sessionID,
    inboxID,
    item: { type: 'user', payload: { text: 'hello' }, delivery: 'steer' },
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
const fork = (
  type: 'before' | 'through',
  messageID: string,
  sessionID = 'ses_2',
  parentID = 'ses_1',
) => ({ sessionID, parentID, boundary: { type, messageID } })

const committed = (to: string, sessionID = 'ses_1') =>
  event('session-revert-committed', { sessionID, to })

// ses_1 history: msg_1 (user), msg_2 (assistant), msg_3 (user).
const parentHistory = [
  created('ses_1'),
  created('ses_2'),
  enqueued('msg_1'),
  delivered('msg_1'),
  stepStarted('msg_2'),
  enqueued('msg_3'),
  delivered('msg_3'),
]

export const forkSessionSpec = createCommandSlice('forkSession')
  .description(
    'Forks a Session: the child starts from the parent history up to a boundary message (session.md: a fork copies messages only through its selected boundary).',
  )
  .scenarios(
    {
      description: 'Forking through a delivered user message records the fork.',
      given: parentHistory,
      when: fork('through', 'msg_1'),
      expect: [forked('ses_2', 'ses_1', 'through', 'msg_1')],
    },
    {
      description:
        'Forking before a delivered message records the fork (the message itself is excluded).',
      given: parentHistory,
      when: fork('before', 'msg_3'),
      expect: [forked('ses_2', 'ses_1', 'before', 'msg_3')],
    },
    {
      description:
        'An assistant message of a started step is a valid boundary.',
      given: parentHistory,
      when: fork('through', 'msg_2'),
      expect: [forked('ses_2', 'ses_1', 'through', 'msg_2')],
    },
    {
      description:
        'Forking before the first message is allowed: the child starts empty.',
      given: parentHistory,
      when: fork('before', 'msg_1'),
      expect: [forked('ses_2', 'ses_1', 'before', 'msg_1')],
    },
    {
      description:
        'The parent may keep growing past the boundary: later messages do not matter.',
      given: [...parentHistory, stepStarted('msg_4')],
      when: fork('through', 'msg_1'),
      expect: [forked('ses_2', 'ses_1', 'through', 'msg_1')],
    },
    {
      description:
        'After a committed revert the boundary itself is still a valid fork point.',
      given: [...parentHistory, committed('msg_2')],
      when: fork('through', 'msg_2'),
      expect: [forked('ses_2', 'ses_1', 'through', 'msg_2')],
    },
    {
      description:
        'After a committed revert, a message past the revert boundary is gone from the parent history: forking through it is rejected.',
      given: [...parentHistory, committed('msg_1')],
      when: fork('through', 'msg_3'),
      expect: [],
      reject: { reason: 'Boundary message not found in parent history' },
    },
    {
      description:
        'After a committed revert, forking before the reverted boundary still works.',
      given: [...parentHistory, committed('msg_2')],
      when: fork('before', 'msg_2'),
      expect: [forked('ses_2', 'ses_1', 'before', 'msg_2')],
    },
    {
      description:
        'A fork of a fork may use a message the middle Session inherited from its parent.',
      given: [
        ...parentHistory,
        created('ses_3'),
        forked('ses_2', 'ses_1', 'through', 'msg_2'),
      ],
      when: fork('before', 'msg_2', 'ses_3', 'ses_2'),
      expect: [forked('ses_3', 'ses_2', 'before', 'msg_2')],
    },
    {
      description:
        'A fork of a fork cannot reach past the middle Session boundary: msg_3 was never copied into it.',
      given: [
        ...parentHistory,
        created('ses_3'),
        forked('ses_2', 'ses_1', 'through', 'msg_2'),
      ],
      when: fork('through', 'msg_3', 'ses_3', 'ses_2'),
      expect: [],
      reject: { reason: 'Boundary message not found in parent history' },
    },
    {
      description: 'An unknown child Session is rejected.',
      given: [created('ses_1'), enqueued('msg_1'), delivered('msg_1')],
      when: fork('through', 'msg_1'),
      expect: [],
      reject: { reason: 'Session not found' },
    },
    {
      description: 'An unknown parent Session is rejected.',
      given: [created('ses_2')],
      when: fork('through', 'msg_1'),
      expect: [],
      reject: { reason: 'Parent session not found' },
    },
    {
      description:
        'A pending inbox item is not history yet, so it is not a boundary.',
      given: [created('ses_1'), created('ses_2'), enqueued('msg_1')],
      when: fork('through', 'msg_1'),
      expect: [],
      reject: { reason: 'Boundary message not found in parent history' },
    },
    {
      description:
        'A message from another Session history is not a boundary of this parent.',
      given: [
        ...parentHistory,
        created('ses_3'),
        enqueued('msg_9', 'ses_3'),
        delivered('msg_9', 'ses_3'),
      ],
      when: fork('through', 'msg_9'),
      expect: [],
      reject: { reason: 'Boundary message not found in parent history' },
    },
    {
      description: 'A Session is forked at most once.',
      given: [...parentHistory, forked('ses_2', 'ses_1', 'through', 'msg_1')],
      when: fork('through', 'msg_2'),
      expect: [],
      reject: { reason: 'Session already forked' },
    },
    {
      description:
        'A child that already has history of its own cannot be forked.',
      given: [
        ...parentHistory,
        enqueued('msg_8', 'ses_2'),
        delivered('msg_8', 'ses_2'),
      ],
      when: fork('through', 'msg_1'),
      expect: [],
      reject: { reason: 'Session already has history' },
    },
    {
      description: 'A Session cannot fork itself.',
      given: parentHistory,
      when: fork('through', 'msg_1', 'ses_1', 'ses_1'),
      expect: [],
      reject: { reason: 'Fork would create a cycle' },
    },
    {
      description: 'A fork cannot make a Session its own ancestor.',
      given: [...parentHistory, forked('ses_2', 'ses_1', 'through', 'msg_1')],
      when: fork('through', 'msg_1', 'ses_1', 'ses_2'),
      expect: [],
      reject: { reason: 'Fork would create a cycle' },
    },
  )

export default forkSessionSpec

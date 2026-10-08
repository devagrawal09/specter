import { createCommandSlice, event } from '@specter-ts/spec'

// Revert is a set of Session-aggregate facts (staged / cleared / committed).
// Staging records the boundary message only: file restoration through
// Snapshot is out of scope (no files or tool calls exist in this app yet), so
// the Revert payload carries no snapshot or files. As in OC++'s revert.ts,
// staging again moves the boundary; it never rejects "already staged".
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
const forked = (sessionID: string, parentID: string, messageID: string) =>
  event('session-forked', {
    sessionID,
    parentID,
    boundary: { type: 'through', messageID },
  })
const execStarted = (sessionID = 'ses_1') =>
  event('session-execution-started', { sessionID })
const execSucceeded = (sessionID = 'ses_1') =>
  event('session-execution-succeeded', { sessionID })
const execFailed = (sessionID = 'ses_1') =>
  event('session-execution-failed', {
    sessionID,
    error: { type: 'provider', message: 'boom' },
  })
const execInterrupted = (sessionID = 'ses_1') =>
  event('session-execution-interrupted', { sessionID, reason: 'user' })
const staged = (messageID: string, sessionID = 'ses_1') =>
  event('session-revert-staged', { sessionID, revert: { messageID } })
const committed = (to: string, sessionID = 'ses_1') =>
  event('session-revert-committed', { sessionID, to })

// ses_1 history: msg_1 (user), msg_2 (assistant), msg_3 (user).
const history = [
  created('ses_1'),
  enqueued('msg_1'),
  delivered('msg_1'),
  stepStarted('msg_2'),
  enqueued('msg_3'),
  delivered('msg_3'),
]

export const stageRevertSpec = createCommandSlice('stageRevert')
  .description(
    'Stages (or moves) a reversible boundary at a message in the Session history (protocol: session.revert.stage).',
  )
  .scenarios(
    {
      description: 'Staging a delivered user message records the boundary.',
      given: history,
      when: { sessionID: 'ses_1', messageID: 'msg_1' },
      expect: [staged('msg_1')],
    },
    {
      description:
        'An assistant message of a started step is a valid boundary.',
      given: history,
      when: { sessionID: 'ses_1', messageID: 'msg_2' },
      expect: [staged('msg_2')],
    },
    {
      description:
        'Staging again moves the boundary (revert.ts stage reuses the original snapshot and replaces the staged revert); no "already staged" rejection.',
      given: [...history, staged('msg_3')],
      when: { sessionID: 'ses_1', messageID: 'msg_1' },
      expect: [staged('msg_1')],
    },
    {
      description:
        'A settled execution (succeeded, failed or interrupted) no longer makes the Session busy.',
      given: [
        ...history,
        execStarted(),
        execSucceeded(),
        execStarted(),
        execFailed(),
        execStarted(),
        execInterrupted(),
      ],
      when: { sessionID: 'ses_1', messageID: 'msg_1' },
      expect: [staged('msg_1')],
    },
    {
      description:
        'A pending (undelivered) inbox item is not history, so it is not a boundary.',
      given: [...history, enqueued('msg_4')],
      when: { sessionID: 'ses_1', messageID: 'msg_4' },
      expect: [],
      reject: { reason: 'Message not found' },
    },
    {
      description: 'An unknown message is not found.',
      given: history,
      when: { sessionID: 'ses_1', messageID: 'msg_9' },
      expect: [],
      reject: { reason: 'Message not found' },
    },
    {
      description:
        'A message past a committed revert boundary is no longer in history.',
      given: [...history, staged('msg_1'), committed('msg_1')],
      when: { sessionID: 'ses_1', messageID: 'msg_3' },
      expect: [],
      reject: { reason: 'Message not found' },
    },
    {
      description:
        'The boundary of a committed revert is still in history and can be staged again.',
      given: [...history, staged('msg_1'), committed('msg_1')],
      when: { sessionID: 'ses_1', messageID: 'msg_1' },
      expect: [staged('msg_1')],
    },
    {
      description:
        'A message copied from a parent by a fork is in the child history.',
      given: [...history, created('ses_2'), forked('ses_2', 'ses_1', 'msg_2')],
      when: { sessionID: 'ses_2', messageID: 'msg_1' },
      expect: [staged('msg_1', 'ses_2')],
    },
    {
      description:
        'A parent message after the fork boundary was never copied into the child.',
      given: [...history, created('ses_2'), forked('ses_2', 'ses_1', 'msg_2')],
      when: { sessionID: 'ses_2', messageID: 'msg_3' },
      expect: [],
      reject: { reason: 'Message not found' },
    },
    {
      description: 'An active execution makes the Session busy.',
      given: [...history, execStarted()],
      when: { sessionID: 'ses_1', messageID: 'msg_1' },
      expect: [],
      reject: { reason: 'Session is busy' },
    },
    {
      description:
        'A new execution after a settled one makes the Session busy again.',
      given: [...history, execStarted(), execSucceeded(), execStarted()],
      when: { sessionID: 'ses_1', messageID: 'msg_1' },
      expect: [],
      reject: { reason: 'Session is busy' },
    },
    {
      description: 'An unknown Session is not found.',
      given: [],
      when: { sessionID: 'ses_missing', messageID: 'msg_1' },
      expect: [],
      reject: { reason: 'Session not found' },
    },
  )

export default stageRevertSpec

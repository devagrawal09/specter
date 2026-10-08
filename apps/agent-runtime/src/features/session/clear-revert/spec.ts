import { createCommandSlice, event } from '@specter-ts/spec'

const created = (sessionID: string) =>
  event('session-created', {
    sessionID,
    projectID: 'prj_1',
    location: { directory: '/tmp/ws' },
    slug: 'brave-otter',
    version: '2',
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
const cleared = (sessionID = 'ses_1') =>
  event('session-revert-cleared', { sessionID })
const committed = (to: string, sessionID = 'ses_1') =>
  event('session-revert-committed', { sessionID, to })

export const clearRevertSpec = createCommandSlice('clearRevert')
  .description(
    'Discards the staged revert (protocol: session.revert.clear). History is untouched: only a commit changes it.',
  )
  .scenarios(
    {
      description: 'Clearing a staged revert records the fact.',
      given: [created('ses_1'), staged('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: [cleared()],
    },
    {
      description:
        'The staged revert may have been moved: clearing still discards it.',
      given: [created('ses_1'), staged('msg_1'), staged('msg_2')],
      when: { sessionID: 'ses_1' },
      expect: [cleared()],
    },
    {
      description:
        'A revert can be staged again after being cleared, then cleared again.',
      given: [created('ses_1'), staged('msg_1'), cleared(), staged('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: [cleared()],
    },
    {
      description:
        'Nothing staged: OC++ clear is a silent no-op (revert.ts returns when session.revert is absent); Specter models the retry as a rejection and the M4 facade translates it back.',
      given: [created('ses_1')],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'No revert staged' },
    },
    {
      description: 'A revert that was already cleared is not staged.',
      given: [created('ses_1'), staged('msg_1'), cleared()],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'No revert staged' },
    },
    {
      description: 'A committed revert is no longer staged.',
      given: [created('ses_1'), staged('msg_1'), committed('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'No revert staged' },
    },
    {
      description:
        'Staged reverts belong to their own Session: another Session has none to clear.',
      given: [created('ses_1'), created('ses_2'), staged('msg_1')],
      when: { sessionID: 'ses_2' },
      expect: [],
      reject: { reason: 'No revert staged' },
    },
    {
      description:
        'An active execution makes the Session busy (protocol: SessionBusyError on revert.clear).',
      given: [created('ses_1'), staged('msg_1'), execStarted()],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'Session is busy' },
    },
    {
      description:
        'A settled execution (succeeded, failed or interrupted) does not make the Session busy.',
      given: [
        created('ses_1'),
        staged('msg_1'),
        execStarted(),
        execSucceeded(),
        execStarted(),
        execFailed(),
        execStarted(),
        execInterrupted(),
      ],
      when: { sessionID: 'ses_1' },
      expect: [cleared()],
    },
    {
      description: 'An unknown Session is not found.',
      given: [],
      when: { sessionID: 'ses_missing' },
      expect: [],
      reject: { reason: 'Session not found' },
    },
  )

export default clearRevertSpec

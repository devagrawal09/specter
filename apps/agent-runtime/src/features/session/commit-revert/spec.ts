import { createCommandSlice, event } from '@specter-ts/spec'

// Commit is the fact (payload: { sessionID, to: boundary messageID }, derived
// from revert.ts: `to: session.revert.messageID`). What it implies for
// history is a projection in session-history-query; the Event Log is not
// truncated. revert.ts commit returns silently without a staged revert;
// Specter models that as a rejection.
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
  event('session-execution-settled', { sessionID, outcome: 'succeeded' })
const execFailed = (sessionID = 'ses_1') =>
  event('session-execution-settled', {
    sessionID,
    outcome: 'failed',
    error: { type: 'provider', message: 'boom' },
  })
const execInterrupted = (sessionID = 'ses_1') =>
  event('session-execution-settled', {
    sessionID,
    outcome: 'interrupted',
    reason: 'user',
  })
const staged = (messageID: string, sessionID = 'ses_1') =>
  event('session-revert-staged', { sessionID, revert: { messageID } })
const cleared = (sessionID = 'ses_1') =>
  event('session-revert-cleared', { sessionID })
const committed = (to: string, sessionID = 'ses_1') =>
  event('session-revert-committed', { sessionID, to })

export const commitRevertSpec = createCommandSlice('commitRevert')
  .description(
    'Commits the staged revert: the Session history ends at the boundary (protocol: session.revert.commit).',
  )
  .scenarios(
    {
      description:
        'Committing a staged revert records the boundary message as `to`.',
      given: [created('ses_1'), staged('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: [committed('msg_1')],
    },
    {
      description: 'A moved boundary commits at the latest staged message.',
      given: [created('ses_1'), staged('msg_1'), staged('msg_2')],
      when: { sessionID: 'ses_1' },
      expect: [committed('msg_2')],
    },
    {
      description:
        'A revert can be staged and committed again after a previous commit.',
      given: [
        created('ses_1'),
        staged('msg_2'),
        committed('msg_2'),
        staged('msg_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: [committed('msg_1')],
    },
    {
      description: 'Nothing staged: no revert to commit.',
      given: [created('ses_1')],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'No revert staged' },
    },
    {
      description: 'A cleared revert cannot be committed.',
      given: [created('ses_1'), staged('msg_1'), cleared()],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'No revert staged' },
    },
    {
      description:
        'A revert that was already committed cannot be committed twice.',
      given: [created('ses_1'), staged('msg_1'), committed('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'No revert staged' },
    },
    {
      description:
        'Staged reverts belong to their own Session: another Session has nothing to commit.',
      given: [created('ses_1'), created('ses_2'), staged('msg_1')],
      when: { sessionID: 'ses_2' },
      expect: [],
      reject: { reason: 'No revert staged' },
    },
    {
      description: 'An active execution makes the Session busy.',
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
      expect: [committed('msg_1')],
    },
    {
      description: 'An unknown Session is not found.',
      given: [],
      when: { sessionID: 'ses_missing' },
      expect: [],
      reject: { reason: 'Session not found' },
    },
  )

export default commitRevertSpec

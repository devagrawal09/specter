import { createCommandSlice, event } from '@specter-ts/spec'

// Execution events carry only the Session ID (failed adds a structured error,
// interrupted a reason). A busy period is: started, not yet ended.
const created = (sessionID = 'ses_1') =>
  event('session-created', {
    sessionID,
    projectID: 'prj_1',
    location: { directory: '/tmp/ws' },
    slug: 'brave-otter',
    version: '2',
  })
const started = (sessionID = 'ses_1') =>
  event('session-execution-started', { sessionID })
const succeeded = (sessionID = 'ses_1') =>
  event('session-execution-settled', { sessionID, outcome: 'succeeded' })
const failed = (sessionID = 'ses_1') =>
  event('session-execution-settled', {
    sessionID,
    outcome: 'failed',
    error: { type: 'provider', message: 'boom' },
  })
const interrupted = (sessionID = 'ses_1') =>
  event('session-execution-settled', {
    sessionID,
    outcome: 'interrupted',
    reason: 'user',
  })

export const startExecutionSpec = createCommandSlice('startExecution')
  .description(
    'Starts a process-local busy period for a Session (session.md: Execution Is Process-Local).',
  )
  .scenarios(
    {
      description:
        'Execution commits a claim when a process-local busy period starts: an idle Session starts.',
      given: [created()],
      when: { sessionID: 'ses_1' },
      expect: [started()],
    },
    {
      description:
        'Explicit resumes join the active execution for the same Session: a second start is rejected, not duplicated.',
      given: [created(), started()],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'Execution already active' },
    },
    {
      description:
        'Success releases the claim: a new busy period may start after success.',
      given: [created(), started(), succeeded()],
      when: { sessionID: 'ses_1' },
      expect: [started()],
    },
    {
      description:
        'Failure releases the claim: a new busy period may start after failure.',
      given: [created(), started(), failed()],
      when: { sessionID: 'ses_1' },
      expect: [started()],
    },
    {
      description:
        'User interruption releases the claim: a new busy period may start after interruption.',
      given: [created(), started(), interrupted()],
      when: { sessionID: 'ses_1' },
      expect: [started()],
    },
    {
      description:
        'Different Sessions run concurrently: an active execution in one Session does not block another.',
      given: [created(), created('ses_2'), started('ses_1')],
      when: { sessionID: 'ses_2' },
      expect: [started('ses_2')],
    },
    {
      description: 'Starting execution for an unknown Session fails.',
      given: [],
      when: { sessionID: 'ses_missing' },
      expect: [],
      reject: { reason: 'Session not found' },
    },
  )

export default startExecutionSpec

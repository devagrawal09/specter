import { createCommandSlice, event } from '@specter-ts/spec'

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
const interrupted = (sessionID = 'ses_1', reason = 'user') =>
  event('session-execution-interrupted', { sessionID, reason })

export const interruptExecutionSpec = createCommandSlice('interruptExecution')
  .description(
    'Interrupts the active execution of a Session without touching pending input (session.md: Execution Is Process-Local). OC++ treats idle/settled interrupt as a public no-op; the app models it as a rejection and the M4 facade translates it back.',
  )
  .scenarios(
    {
      description:
        'Interruption stops locally owned execution: an active execution is interrupted (reason defaults to user).',
      given: [created(), started()],
      when: { sessionID: 'ses_1' },
      expect: [interrupted()],
    },
    {
      description:
        'The interruption reason is recorded (user, shutdown, superseded).',
      given: [created(), started()],
      when: { sessionID: 'ses_1', reason: 'shutdown' },
      expect: [interrupted('ses_1', 'shutdown')],
    },
    {
      description:
        'Interruption stops locally owned execution without deleting pending input: a pending inbox item yields only the interrupted event.',
      given: [
        created(),
        event('session-inbox-enqueued', {
          sessionID: 'ses_1',
          inboxID: 'msg_1',
          item: {
            type: 'user',
            payload: { text: 'still pending' },
            delivery: 'queue',
          },
        }),
        started(),
      ],
      when: { sessionID: 'ses_1' },
      expect: [interrupted()],
    },
    {
      description:
        'A known Session that is idle is a public no-op in OC++; modelled as the rejection "Session is idle".',
      given: [created()],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'Session is idle' },
    },
    {
      description:
        'A known Session that is settled is a public no-op in OC++; modelled as "Session is idle" (success released the claim).',
      given: [
        created(),
        started(),
        event('session-execution-succeeded', { sessionID: 'ses_1' }),
      ],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'Session is idle' },
    },
    {
      description:
        'Failure releases the claim: interrupting a failed (settled) Session is a no-op in OC++; modelled as "Session is idle".',
      given: [
        created(),
        started(),
        event('session-execution-failed', {
          sessionID: 'ses_1',
          error: { type: 'provider', message: 'boom' },
        }),
      ],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'Session is idle' },
    },
    {
      description:
        'A second interrupt after an interruption is a no-op in OC++; modelled as "Session is idle".',
      given: [created(), started(), interrupted()],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'Session is idle' },
    },
    {
      description:
        'The public interrupt operation verifies that the durable Session exists: an unknown Session fails.',
      given: [],
      when: { sessionID: 'ses_missing' },
      expect: [],
      reject: { reason: 'Session not found' },
    },
    {
      description:
        'Different Sessions run concurrently: interrupting one does not require the other to be active.',
      given: [created(), created('ses_2'), started('ses_1')],
      when: { sessionID: 'ses_2' },
      expect: [],
      reject: { reason: 'Session is idle' },
    },
  )

export default interruptExecutionSpec

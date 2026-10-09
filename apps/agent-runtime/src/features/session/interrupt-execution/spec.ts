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
  event('session-execution-settled', {
    sessionID,
    outcome: 'interrupted',
    reason,
  })

const model = { id: 'scripted', providerID: 'test' }
const stepStarted = (assistantMessageID = 'msg_1', sessionID = 'ses_1') =>
  event('session-step-started', {
    sessionID,
    assistantMessageID,
    agent: 'build',
    model,
  })
const requested = (
  id: string,
  name: string,
  assistantMessageID = 'msg_1',
  executed = false,
) =>
  event('session-tool-requested', {
    sessionID: 'ses_1',
    assistantMessageID,
    id,
    name,
    input: { code: 'x' },
    executed,
  })
const abortedFailure = (id: string, name: string, executed = false) =>
  event('session-tool-settled', {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_1',
    id,
    outcome: 'failed',
    error: { type: 'aborted', message: `Tool execution interrupted: ${name}` },
    executed,
  })

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
        'An open tool call is settled atomically with the interrupt: one aborted tool failure (naming the tool) precedes the interrupted execution in the same commit.',
      given: [
        created(),
        started(),
        stepStarted(),
        requested('call_1', 'execute'),
      ],
      when: { sessionID: 'ses_1' },
      expect: [abortedFailure('call_1', 'execute'), interrupted()],
    },
    {
      description:
        'Every open call is settled in call order, and the executed flag of each call is carried over; settled calls are left alone.',
      given: [
        created(),
        started(),
        stepStarted(),
        requested('call_1', 'execute'),
        requested('call_2', 'execute', 'msg_1', true),
        requested('call_3', 'lookup'),
        event('session-tool-settled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          id: 'call_3',
          outcome: 'succeeded',
          executed: true,
          content: [{ type: 'text', text: 'ok' }],
        }),
      ],
      when: { sessionID: 'ses_1' },
      expect: [
        abortedFailure('call_1', 'execute'),
        abortedFailure('call_2', 'execute', true),
        interrupted(),
      ],
    },
    {
      description:
        'A call that already failed is settled and not failed again: only the interrupted event is emitted.',
      given: [
        created(),
        started(),
        stepStarted(),
        requested('call_1', 'execute'),
        abortedFailure('call_1', 'execute'),
      ],
      when: { sessionID: 'ses_1' },
      expect: [interrupted()],
    },
    {
      description:
        'A new step attempt starts with a clean call table: calls left open by an earlier attempt are not settled by the interrupt.',
      given: [
        created(),
        started(),
        stepStarted('msg_1'),
        requested('call_1', 'execute'),
        stepStarted('msg_2'),
      ],
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
        event('session-execution-settled', {
          sessionID: 'ses_1',
          outcome: 'succeeded',
        }),
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
        event('session-execution-settled', {
          sessionID: 'ses_1',
          outcome: 'failed',
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

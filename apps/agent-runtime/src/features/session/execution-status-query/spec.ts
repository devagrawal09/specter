import { createQuerySlice, event } from '@specter-ts/spec'

// Folded from durable execution events. Per session.md, durable execution
// events are a historical record; this answers "what do the events say", and
// is not proof that a process is still live.
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

export const executionStatusSpec = createQuerySlice('executionStatus')
  .description(
    'Reports whether a Session is idle, actively executing, or settled, with its last outcome (session.md: Execution Is Process-Local).',
  )
  .scenarios(
    {
      description:
        'A Session with no execution events is idle (no busy period has started).',
      given: [],
      when: { sessionID: 'ses_1' },
      expect: { status: 'idle', executions: 0, lastOutcome: null },
    },
    {
      description:
        'A started, unended execution is a busy period currently owned: active.',
      given: [started()],
      when: { sessionID: 'ses_1' },
      expect: { status: 'active', executions: 1, lastOutcome: null },
    },
    {
      description: 'Success releases the claim: the Session is settled.',
      given: [started(), succeeded()],
      when: { sessionID: 'ses_1' },
      expect: { status: 'settled', executions: 1, lastOutcome: 'succeeded' },
    },
    {
      description:
        'Failure releases the claim: the Session is settled, with the error that failed it.',
      given: [started(), failed()],
      when: { sessionID: 'ses_1' },
      expect: {
        status: 'settled',
        executions: 1,
        lastOutcome: 'failed',
        error: { type: 'provider', message: 'boom' },
      },
    },
    {
      description:
        'Interruption ends the busy period: the Session is settled with outcome interrupted and its reason.',
      given: [started(), interrupted()],
      when: { sessionID: 'ses_1' },
      expect: {
        status: 'settled',
        executions: 1,
        lastOutcome: 'interrupted',
        reason: 'user',
      },
    },
    {
      description:
        'A new busy period after a settled one makes the Session active again.',
      given: [started(), succeeded(), started()],
      when: { sessionID: 'ses_1' },
      expect: { status: 'active', executions: 2, lastOutcome: 'succeeded' },
    },
    {
      description:
        'Different Sessions run concurrently: status is per Session, so an active ses_2 leaves ses_1 idle.',
      given: [started('ses_2')],
      when: { sessionID: 'ses_1' },
      expect: { status: 'idle', executions: 0, lastOutcome: null },
    },
  )

export default executionStatusSpec

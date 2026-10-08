import { createCommandSlice, event } from '@specter-ts/spec'

// session.md: One Step May Have Several Physical Attempts. A step is a busy
// period's unit of work: started, then ended. Only an active execution may run
// steps, and one step is in flight per Session at a time.
const model = { id: 'scripted', providerID: 'test' }
const started = (sessionID = 'ses_1') =>
  event('session-execution-started', { sessionID })
const succeeded = (sessionID = 'ses_1') =>
  event('session-execution-succeeded', { sessionID })
const failed = (sessionID = 'ses_1') =>
  event('session-execution-failed', {
    sessionID,
    error: { type: 'provider', message: 'boom' },
  })
const interrupted = (sessionID = 'ses_1') =>
  event('session-execution-interrupted', { sessionID, reason: 'user' })
const stepStarted = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-started', {
    sessionID,
    assistantMessageID,
    agent: 'build',
    model,
  })
const stepEnded = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-ended', {
    sessionID,
    assistantMessageID,
    finish: 'tool-calls',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
const boom = { type: 'transport', message: 'connection reset' }
const stepFailed = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-failed', { sessionID, assistantMessageID, error: boom })
const retryScheduled = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-retry-scheduled', {
    sessionID,
    assistantMessageID,
    attempt: 1,
    at: 1000,
    error: boom,
  })
const step = (assistantMessageID: string, sessionID = 'ses_1') => ({
  sessionID,
  assistantMessageID,
  agent: 'build',
  model,
})

export const recordStepStartedSpec = createCommandSlice('recordStepStarted')
  .description(
    'Records that a step began inside an active execution (session.md: One Step May Have Several Physical Attempts).',
  )
  .scenarios(
    {
      description: 'An active execution starts its first step.',
      given: [started()],
      when: step('msg_1'),
      expect: [stepStarted('msg_1')],
    },
    {
      description:
        'The snapshot taken at the step boundary is recorded with the step.',
      given: [started()],
      when: { ...step('msg_1'), snapshot: 'snap_1' },
      expect: [
        event('session-step-started', {
          ...step('msg_1'),
          snapshot: 'snap_1',
        }),
      ],
    },
    {
      description: 'A next step starts once the previous step has ended.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1')],
      when: step('msg_2'),
      expect: [stepStarted('msg_2')],
    },
    {
      description: 'A Session without an active execution cannot run a step.',
      given: [],
      when: step('msg_1'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'A succeeded execution is not active: no step starts.',
      given: [started(), succeeded()],
      when: step('msg_1'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'An interrupted execution is not active: no step starts.',
      given: [started(), interrupted()],
      when: step('msg_1'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'One step is in flight per Session: a second start is rejected.',
      given: [started(), stepStarted('msg_1')],
      when: step('msg_2'),
      expect: [],
      reject: { reason: 'Step already in flight' },
    },
    {
      description:
        'A step ID is used once: restarting an ended step is rejected, which makes a duplicate step request harmless.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1')],
      when: step('msg_1'),
      expect: [],
      reject: { reason: 'Step already started' },
    },
    {
      description:
        'A step abandoned by an interrupted execution does not block the next execution.',
      given: [started(), stepStarted('msg_1'), interrupted(), started()],
      when: step('msg_2'),
      expect: [stepStarted('msg_2')],
    },
    {
      description:
        'Sessions are independent: a step in flight in ses_1 does not block ses_2.',
      given: [started('ses_1'), started('ses_2'), stepStarted('msg_1')],
      when: step('msg_2', 'ses_2'),
      expect: [stepStarted('msg_2', 'ses_2')],
    },
    {
      description: 'A failed execution is not active: no step starts.',
      given: [started(), failed()],
      when: step('msg_1'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'A scheduled retry starts another physical attempt of the same step: the assistant message ID is reused.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
        retryScheduled('msg_1'),
      ],
      when: step('msg_1'),
      expect: [stepStarted('msg_1')],
    },
    {
      description:
        'A failed step without a scheduled retry cannot start again: the id stays taken.',
      given: [started(), stepStarted('msg_1'), stepFailed('msg_1')],
      when: step('msg_1'),
      expect: [],
      reject: { reason: 'Step already started' },
    },
    {
      description:
        'A failed attempt is over: the next step can start without waiting for the failed one to end.',
      given: [started(), stepStarted('msg_1'), stepFailed('msg_1')],
      when: step('msg_2'),
      expect: [stepStarted('msg_2')],
    },
    {
      description:
        'A scheduled retry is spent by the attempt it starts: the same step cannot start a third time without another retry.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
        retryScheduled('msg_1'),
        stepStarted('msg_1'),
      ],
      when: step('msg_1'),
      expect: [],
      reject: { reason: 'Step already started' },
    },
  )

export default recordStepStartedSpec

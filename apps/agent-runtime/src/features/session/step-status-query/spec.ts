import { createQuerySlice, event } from '@specter-ts/spec'

// Folded from execution and step events. The step plugin reads it at the safe
// step boundary to decide whether a (possibly stale) step request still applies.
const boom = { type: 'transport', message: 'connection reset' }
const model = { id: 'scripted', providerID: 'test' }
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
const stepStarted = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-started', {
    sessionID,
    assistantMessageID,
    agent: 'build',
    model,
  })
const stepFailed = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-settled', {
    sessionID,
    assistantMessageID,
    outcome: 'failed',
    error: boom,
  })
const stepRetried = (assistantMessageID: string, attempt: number) =>
  event('session-step-settled', {
    sessionID: 'ses_1',
    assistantMessageID,
    outcome: 'failed',
    error: boom,
    retry: { attempt, at: 1000 },
  })
const stepEnded = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-settled', {
    sessionID,
    assistantMessageID,
    outcome: 'succeeded',
    finish: 'stop',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })

const toolCalled = (
  assistantMessageID: string,
  id: string,
  executed = false,
  sessionID = 'ses_1',
) => [
  event('session-tool-input-started', {
    sessionID,
    assistantMessageID,
    id,
    name: 'execute',
  }),
  event('session-tool-called', {
    sessionID,
    assistantMessageID,
    id,
    input: { code: '1' },
    executed,
  }),
]
const toolSucceeded = (assistantMessageID: string, id: string) =>
  event('session-tool-success', {
    sessionID: 'ses_1',
    assistantMessageID,
    id,
    content: [{ type: 'text', text: '2' }],
    executed: false,
  })
const toolFailed = (assistantMessageID: string, id: string) =>
  event('session-tool-failed', {
    sessionID: 'ses_1',
    assistantMessageID,
    id,
    error: { type: 'aborted', message: 'Tool execution interrupted: execute' },
    executed: false,
  })
const open = (assistantMessageID: string, id: string, executed = false) => ({
  assistantMessageID,
  id,
  name: 'execute',
  executed,
})

export const stepStatusSpec = createQuerySlice('stepStatus')
  .description(
    'Reports whether a Session has an active execution, a step in flight (and which), how many steps it has started, and the physical attempts and last failure of its latest step.',
  )
  .scenarios(
    {
      description: 'A Session with no events has nothing active.',
      given: [],
      when: { sessionID: 'ses_1' },
      expect: {
        active: false,
        stepInFlight: false,
        stepsStarted: 0,
        attempts: 0,
      },
    },
    {
      description: 'A started execution with no step is active, between steps.',
      given: [started()],
      when: { sessionID: 'ses_1' },
      expect: {
        active: true,
        stepInFlight: false,
        stepsStarted: 0,
        attempts: 0,
      },
    },
    {
      description: 'A started, unended step is in flight.',
      given: [started(), stepStarted('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: {
        active: true,
        stepInFlight: true,
        inFlightStepID: 'msg_1',
        stepsStarted: 1,
        attempts: 1,
      },
    },
    {
      description: 'An ended step is no longer in flight but stays counted.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: {
        active: true,
        stepInFlight: false,
        stepsStarted: 1,
        attempts: 1,
      },
    },
    {
      description:
        'Interruption clears the in-flight step and the active flag; the count stays.',
      given: [started(), stepStarted('msg_1'), interrupted()],
      when: { sessionID: 'ses_1' },
      expect: {
        active: false,
        stepInFlight: false,
        stepsStarted: 1,
        attempts: 1,
      },
    },
    {
      description: 'The step count spans executions of one Session.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepEnded('msg_1'),
        succeeded(),
        started(),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        active: true,
        stepInFlight: false,
        stepsStarted: 1,
        attempts: 1,
      },
    },
    {
      description: 'Sessions are independent.',
      given: [
        started('ses_1'),
        started('ses_2'),
        stepStarted('msg_1', 'ses_2'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        active: true,
        stepInFlight: false,
        stepsStarted: 0,
        attempts: 0,
      },
    },
    {
      description:
        'A failed execution is no longer active; the step count stays.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1'), failed()],
      when: { sessionID: 'ses_1' },
      expect: {
        active: false,
        stepInFlight: false,
        stepsStarted: 1,
        attempts: 1,
      },
    },
    {
      description:
        'A failed attempt is no longer in flight and exposes its failure; the attempt still counts.',
      given: [started(), stepStarted('msg_1'), stepFailed('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: {
        active: true,
        stepInFlight: false,
        stepsStarted: 1,
        attempts: 1,
        lastFailure: boom,
      },
    },
    {
      description:
        'A scheduled retry keeps the failure visible until the next attempt starts.',
      given: [started(), stepStarted('msg_1'), stepRetried('msg_1', 1)],
      when: { sessionID: 'ses_1' },
      expect: {
        active: true,
        stepInFlight: false,
        stepsStarted: 1,
        attempts: 1,
        lastFailure: boom,
      },
    },
    {
      description:
        'The retried attempt is the same step with a second physical attempt: the step count does not grow and the failure clears.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepRetried('msg_1', 1),
        stepStarted('msg_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        active: true,
        stepInFlight: true,
        inFlightStepID: 'msg_1',
        stepsStarted: 1,
        attempts: 2,
      },
    },
    {
      description:
        'A retried step that then ends reports every attempt it took.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepRetried('msg_1', 1),
        stepStarted('msg_1'),
        stepEnded('msg_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        active: true,
        stepInFlight: false,
        stepsStarted: 1,
        attempts: 2,
      },
    },
    {
      description: 'The next step starts counting its attempts from one.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepRetried('msg_1', 1),
        stepStarted('msg_1'),
        stepEnded('msg_1'),
        stepStarted('msg_2'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        active: true,
        stepInFlight: true,
        inFlightStepID: 'msg_2',
        stepsStarted: 2,
        attempts: 1,
      },
    },
    {
      description:
        'A terminal execution event clears the projected failure; the counts stay.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
        event('session-execution-settled', {
          sessionID: 'ses_1',
          outcome: 'failed',
          error: boom,
        }),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        active: false,
        stepInFlight: false,
        stepsStarted: 1,
        attempts: 1,
      },
    },
    {
      description:
        'A recorded call with no outcome is open, with its name and executed flag.',
      given: [
        started(),
        stepStarted('msg_1'),
        ...toolCalled('msg_1', 'call_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        active: true,
        stepInFlight: true,
        inFlightStepID: 'msg_1',
        stepsStarted: 1,
        attempts: 1,
        openCalls: [open('msg_1', 'call_1')],
      },
    },
    {
      description:
        'Open calls keep call order, and a settled one (success or failure) leaves the list.',
      given: [
        started(),
        stepStarted('msg_1'),
        ...toolCalled('msg_1', 'call_1'),
        ...toolCalled('msg_1', 'call_2', true),
        ...toolCalled('msg_1', 'call_3'),
        toolSucceeded('msg_1', 'call_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        active: true,
        stepInFlight: true,
        inFlightStepID: 'msg_1',
        stepsStarted: 1,
        attempts: 1,
        openCalls: [open('msg_1', 'call_2', true), open('msg_1', 'call_3')],
      },
    },
    {
      description:
        'When every call is settled the field is omitted, whatever the outcome.',
      given: [
        started(),
        stepStarted('msg_1'),
        ...toolCalled('msg_1', 'call_1'),
        ...toolCalled('msg_1', 'call_2'),
        toolSucceeded('msg_1', 'call_1'),
        toolFailed('msg_1', 'call_2'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        active: true,
        stepInFlight: true,
        inFlightStepID: 'msg_1',
        stepsStarted: 1,
        attempts: 1,
      },
    },
    {
      description:
        'A new attempt of the same step starts with a clean call table: calls the failed attempt left open are not reported.',
      given: [
        started(),
        stepStarted('msg_1'),
        ...toolCalled('msg_1', 'call_1'),
        stepRetried('msg_1', 1),
        stepStarted('msg_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        active: true,
        stepInFlight: true,
        inFlightStepID: 'msg_1',
        stepsStarted: 1,
        attempts: 2,
      },
    },
    {
      description:
        'A terminal execution event drops open calls: an interrupted execution has nothing left to settle.',
      given: [
        started(),
        stepStarted('msg_1'),
        ...toolCalled('msg_1', 'call_1'),
        interrupted(),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        active: false,
        stepInFlight: false,
        stepsStarted: 1,
        attempts: 1,
      },
    },
    {
      description:
        'An interrupt commits the aborted settlement of every open call before the interrupted event: openCalls is empty afterwards.',
      given: [
        started(),
        stepStarted('msg_1'),
        ...toolCalled('msg_1', 'call_1'),
        ...toolCalled('msg_1', 'call_2', true),
        toolFailed('msg_1', 'call_1'),
        toolFailed('msg_1', 'call_2'),
        interrupted(),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        active: false,
        stepInFlight: false,
        stepsStarted: 1,
        attempts: 1,
      },
    },
  )

export default stepStatusSpec

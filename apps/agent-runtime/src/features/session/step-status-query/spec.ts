import { createQuerySlice, event } from '@specter-ts/spec'

// Folded from execution and step events. The step plugin reads it at the safe
// step boundary to decide whether a (possibly stale) step request still applies.
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
    finish: 'stop',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })

export const stepStatusSpec = createQuerySlice('stepStatus')
  .description(
    'Reports whether a Session has an active execution, a step in flight, and how many steps it has started.',
  )
  .scenarios(
    {
      description: 'A Session with no events has nothing active.',
      given: [],
      when: { sessionID: 'ses_1' },
      expect: { active: false, stepInFlight: false, stepsStarted: 0 },
    },
    {
      description: 'A started execution with no step is active, between steps.',
      given: [started()],
      when: { sessionID: 'ses_1' },
      expect: { active: true, stepInFlight: false, stepsStarted: 0 },
    },
    {
      description: 'A started, unended step is in flight.',
      given: [started(), stepStarted('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: { active: true, stepInFlight: true, stepsStarted: 1 },
    },
    {
      description: 'An ended step is no longer in flight but stays counted.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: { active: true, stepInFlight: false, stepsStarted: 1 },
    },
    {
      description:
        'Interruption clears the in-flight step and the active flag; the count stays.',
      given: [started(), stepStarted('msg_1'), interrupted()],
      when: { sessionID: 'ses_1' },
      expect: { active: false, stepInFlight: false, stepsStarted: 1 },
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
      expect: { active: true, stepInFlight: false, stepsStarted: 1 },
    },
    {
      description: 'Sessions are independent.',
      given: [
        started('ses_1'),
        started('ses_2'),
        stepStarted('msg_1', 'ses_2'),
      ],
      when: { sessionID: 'ses_1' },
      expect: { active: true, stepInFlight: false, stepsStarted: 0 },
    },
    {
      description:
        'A failed execution is no longer active; the step count stays.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1'), failed()],
      when: { sessionID: 'ses_1' },
      expect: { active: false, stepInFlight: false, stepsStarted: 1 },
    },
  )

export default stepStatusSpec

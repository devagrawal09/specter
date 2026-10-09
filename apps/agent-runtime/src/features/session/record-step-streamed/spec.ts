import { createCommandSlice, event } from '@specter-ts/spec'

// session.md: a step's provider stream ends before its local tools settle.
// That boundary is durable: the attempt has everything the model sent, and
// what follows is the tools' work.
const model = { id: 'scripted', providerID: 'test' }
const started = (sessionID = 'ses_1') =>
  event('session-execution-started', { sessionID })
const succeeded = (sessionID = 'ses_1') =>
  event('session-execution-settled', { sessionID, outcome: 'succeeded' })
const stepStarted = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-started', {
    sessionID,
    assistantMessageID,
    agent: 'build',
    model,
  })
const streamed = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-streamed', { sessionID, assistantMessageID })
const stepEnded = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-settled', {
    sessionID,
    assistantMessageID,
    outcome: 'succeeded',
    finish: 'tool-calls',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
const stepRetried = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-settled', {
    sessionID,
    assistantMessageID,
    outcome: 'failed',
    error: { type: 'transport', message: 'connection reset' },
    retry: { attempt: 1, at: 1000 },
  })
const step = (assistantMessageID: string, sessionID = 'ses_1') => ({
  sessionID,
  assistantMessageID,
})

export const recordStepStreamedSpec = createCommandSlice('recordStepStreamed')
  .description(
    "Records that a step's provider stream ended, before its local tools settle.",
  )
  .scenarios(
    {
      description: 'The step in flight records that its stream ended.',
      given: [started(), stepStarted('msg_1')],
      when: step('msg_1'),
      expect: [streamed('msg_1')],
    },
    {
      description: 'An attempt streams once.',
      given: [started(), stepStarted('msg_1'), streamed('msg_1')],
      when: step('msg_1'),
      expect: [],
      reject: { reason: 'Step already streamed' },
    },
    {
      description: 'A retried attempt of the same step streams again.',
      given: [
        started(),
        stepStarted('msg_1'),
        streamed('msg_1'),
        stepRetried('msg_1'),
        stepStarted('msg_1'),
      ],
      when: step('msg_1'),
      expect: [streamed('msg_1')],
    },
    {
      description: 'Only the step in flight can stream.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1')],
      when: step('msg_1'),
      expect: [],
      reject: { reason: 'Step not in flight' },
    },
    {
      description: 'A stream outside an active execution is rejected.',
      given: [started(), stepStarted('msg_1'), succeeded()],
      when: step('msg_1'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
  )

export default recordStepStreamedSpec
